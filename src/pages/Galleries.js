import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import './Galleries.css';
import googleDriveService from '../services/googleDriveService';
const PREVIEW_CACHE_KEY = 'folderPreviewCacheV2';
const PREVIEW_CACHE_TTL_MS = 1000 * 60 * 60 * 72; // 72 hours
const PREFETCH_INITIAL_LIMIT = 8; // prefetch only first N subfolders immediately
const PREFETCH_CONCURRENCY = 4;   // concurrent preview fetches
const PREFETCH_OBSERVER_ROOT_MARGIN = '250px'; // start fetching slightly before entering viewport
const OVERLAY_PREFETCH_LIMIT = 60; // prefetch up to N images per folder
const OVERLAY_PREFETCH_CONCURRENCY = 4; // concurrent overlay prefetch

function importAll(r) {
  const images = {};
  r.keys().forEach((key) => {
    const pathParts = key.replace('./', '').split('/');
    let current = images;

    pathParts.forEach((part, i) => {
      if (i === pathParts.length - 1) {
        if (part.toLowerCase().endsWith('.jpg')) {
          current[part] = r(key);
        }
      } else {
        current[part] = current[part] || {};
        current = current[part];
      }
    });
  });
  return images;
}

const localGalleryStructure = importAll(
  require.context('../assets/galleries', true, /\.(jpg)$/)
);

function getCurrentDirectory(structure, pathParts) {
  let current = structure;
  for (let part of pathParts) {
    current = current[part];
    if (!current) break;
  }
  return current;
}

function getRandomImageFromFolder(folderContent) {
  const allImages = [];
  const isIconName = (name) => {
    const n = (name || '').toLowerCase();
    return n === 'icon.jpg' || n === 'icon.jpeg';
  };
  
  function collectImages(obj) {
    Object.entries(obj).forEach(([name, value]) => {
      if (typeof value === 'string') {
        if (!isIconName(name)) {
          allImages.push(value);
        }
      } else if (typeof value === 'object') {
        collectImages(value);
      }
    });
  }
  
  collectImages(folderContent);
  
  if (allImages.length > 0) {
    const randomIndex = Math.floor(Math.random() * allImages.length);
    return allImages[randomIndex];
  }
  
  return null;
}

// Collect up to `limit` images from a nested folder structure
function collectImagesWithLimit(obj, limit, acc = []) {
  const isIconName = (name) => {
    const n = (name || '').toLowerCase();
    return n === 'icon.jpg' || n === 'icon.jpeg';
  };
  if (!obj || acc.length >= limit) return acc;
  for (const [name, value] of Object.entries(obj)) {
    if (acc.length >= limit) break;
    if (typeof value === 'string') {
      if (isIconName(name)) continue;
      acc.push(value);
    } else if (typeof value === 'object') {
      collectImagesWithLimit(value, limit, acc);
    }
  }
  return acc;
}

// Prefer local asset for root folder preview, if available
function getLocalPreviewForFolder(folderName) {
  const localRoot = getCurrentDirectory(localGalleryStructure || {}, []);
  const folderContent = localRoot ? localRoot[folderName] : null;
  if (!folderContent) return null;
  // STRICT: prefer icon.jpg or icon.jpeg only
  const iconEntry = Object.entries(folderContent).find(
    ([name, value]) => typeof value === 'string' && name.toLowerCase() === 'icon.jpg'
  ) || Object.entries(folderContent).find(
    ([name, value]) => typeof value === 'string' && name.toLowerCase() === 'icon.jpeg'
  );
  if (iconEntry) return iconEntry[1];
  // Fallback for root if icon is missing
  const directImage = Object.entries(folderContent).find(
    ([name, value]) => typeof value === 'string'
  );
  const previewImageSrc = directImage ? directImage[1] : getRandomImageFromFolder(folderContent);
  return previewImageSrc || null;
}

// Prefer local icon for any folder path, if available
function getLocalIconForPath(pathParts) {
  const localNode = getCurrentDirectory(localGalleryStructure || {}, pathParts);
  if (!localNode) return null;
  const match = Object.entries(localNode).find(
    ([name, value]) => typeof value === 'string' && (name.toLowerCase() === 'icon.jpg' || name.toLowerCase() === 'icon.jpeg')
  );
  return match ? match[1] : null;
}

function Galleries() {
  const [path, setPath] = useState([]);
  const currentPathKey = path.join('/');
  
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [activeStructure, setActiveStructure] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [renderCount, setRenderCount] = useState(0); // progressive grid rendering
  const [driveStructure, setDriveStructure] = useState(null);
  const [usingDrive, setUsingDrive] = useState(false);
  const [hasPrefetched, setHasPrefetched] = useState(false);
  const [folderPreviews, setFolderPreviews] = useState({});
  const [loadingBar, setLoadingBar] = useState({ active: false, mode: 'indeterminate', progress: 0 });
  const location = useLocation();
  const [images, setImages] = useState([]);

  // Reset path when navigating to galleries from other pages
  useEffect(() => {
    // Only reset if we're coming from a different page (not just refreshing)
    if (location.pathname === '/galleries' && location.state?.resetPath !== false) {
      setPath([]);
    }
  }, [location.pathname, location.state?.resetPath]);

  // Render root quickly with local assets, then load Drive structure in background
  useEffect(() => {
    let cancelled = false;
    // Immediate render using local assets for root icons
    setActiveStructure(localGalleryStructure);
    setIsLoading(false);

    (async () => {
      try {
        // Use cached Drive structure if available for faster readiness
        const cached = sessionStorage.getItem('driveGalleryStructure');
        if (!cancelled && cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed && Object.keys(parsed).length > 0) {
              setDriveStructure(parsed);
              setActiveStructure(parsed);
              setUsingDrive(true);
            }
          } catch (_) {}
        }

        // Kick off a quick root listing in parallel to enable Drive mode immediately
        try {
          const rootFolders = await googleDriveService.getGalleryFolders();
          if (!cancelled && rootFolders && rootFolders.length > 0) {
            const minimalDrive = {};
            for (const f of rootFolders) {
              if ((f.name || '').toLowerCase() === 'slideshow') continue; // safety
              minimalDrive[f.name] = {}; // empty folder; preview uses local asset if available
            }
            setDriveStructure(prev => prev || minimalDrive);
            try {
              sessionStorage.setItem('driveRootListing', JSON.stringify(minimalDrive));
            } catch (_) {}
            setUsingDrive(true);
          }
        } catch (_) {}

        // Removed expensive full Drive tree build to improve performance
        // Root listing above is enough; deeper levels load progressively on navigation.
      } catch (err) {
        console.warn('Drive galleries unavailable, continuing with local assets');
        // Attempt minimal root listing even on error
        try {
          const rootFolders = await googleDriveService.getGalleryFolders();
          if (rootFolders && rootFolders.length > 0) {
            const minimalDrive = {};
            for (const f of rootFolders) {
              if ((f.name || '').toLowerCase() === 'slideshow') continue;
              minimalDrive[f.name] = {};
            }
            setDriveStructure(minimalDrive);
            setUsingDrive(true);
          }
        } catch (_) {}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Progressive Drive loading: fetch one level on navigation and merge into driveStructure
  useEffect(() => {
    (async () => {
      if (!usingDrive) return;
      if (path.length === 0) return; // keep root fast/local; Drive root loads in background
      try {
        // Indeterminate loading while fetching one-level structure
        setLoadingBar(prev => (prev.active && prev.mode === 'determinate') ? prev : { active: true, mode: 'indeterminate', progress: 0 });
        const folderId = await googleDriveService.resolveFolderIdByPath(path);
        if (!folderId) {
          setLoadingBar(prev => prev.mode === 'indeterminate' ? { active: false, mode: 'indeterminate', progress: 0 } : prev);
          return;
        }
        const node = await googleDriveService.buildOneLevelStructure(folderId);
        if (node && Object.keys(node).length > 0) {
          setDriveStructure(prev => {
            const newTree = JSON.parse(JSON.stringify(prev || {}));
            let cursor = newTree;
            for (const seg of path) {
              cursor[seg] = cursor[seg] || {};
              cursor = cursor[seg];
            }
            Object.assign(cursor, node);
            return newTree;
          });
        }
        // Done with one-level structure
        setLoadingBar(prev => prev.mode === 'indeterminate' ? { active: false, mode: 'indeterminate', progress: 0 } : prev);
      } catch (err) {
        console.warn('Failed to progressively load Drive folder', err);
        setLoadingBar(prev => prev.mode === 'indeterminate' ? { active: false, mode: 'indeterminate', progress: 0 } : prev);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPathKey, usingDrive]);

  // Prefetch fast preview thumbnails for immediate subfolders on navigation
  useEffect(() => {
    if (!usingDrive) return;
    let cancelled = false;
    let observerCleanup = null;
    (async () => {
      try {
        const parentId = await googleDriveService.resolveFolderIdByPath(path);
        if (!parentId) return;
        let subs = await googleDriveService.getSubfolders(parentId);
        // sort subs by name to match UI order
        subs = (subs || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        // Read cache from localStorage with TTL eviction
        let cache = {};
        try {
          const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          const now = Date.now();
          Object.entries(parsed || {}).forEach(([k, v]) => {
            if (v && typeof v === 'object' && v.ts && (now - v.ts) < PREVIEW_CACHE_TTL_MS) {
              cache[k] = { thumb: v.thumb, uc: v.uc, ts: v.ts };
            }
          });
        } catch (_) {}
        const basePath = currentPathKey;
        const idByKey = new Map();
        const toFetchAll = [];
        const updates = {};
        for (const s of subs) {
          const key = `${basePath}/${s.name}`;
          idByKey.set(key, s.id);
          if (cache && cache[key]) {
            updates[key] = { thumb: cache[key].thumb, uc: cache[key].uc };
          } else {
            toFetchAll.push({ key, id: s.id });
          }
        }
        // Initial batch: fetch ALL immediate subfolder icons eagerly
        const toFetch = toFetchAll;
         const total = toFetch.length;
         if (total > 0) setLoadingBar({ active: true, mode: 'determinate', progress: Math.max(8, Math.round((Object.keys(updates).length / (subs.length || 1)) * 100)) });
         let i = 0;
         let processed = 0;
         async function worker() {
           while (i < toFetch.length) {
             const idx = i++;
             const { key, id } = toFetch[idx];
             const icon = await googleDriveService.getIconFromFolder(id);
             const file = icon || await googleDriveService.getFirstImageInTree(id, 2);
             if (file) {
               updates[key] = { thumb: file.thumbUrl, uc: file.ucUrl };
             } else {
               updates[key] = { thumb: null, uc: null };
             }
             processed += 1;
             if (!cancelled && total > 0) {
               const pct = Math.min(100, Math.max(10, Math.round((processed / total) * 100)));
               setLoadingBar(prev => ({ active: true, mode: 'determinate', progress: pct }));
             }
           }
         }
         await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, toFetch.length) }, () => worker()));
         if (cancelled) return;
         setFolderPreviews(prev => ({ ...prev, ...updates }));
         // Persist cache with timestamps
         try {
           const now = Date.now();
           const merged = { ...(cache || {}) };
           Object.entries(updates).forEach(([k, v]) => { merged[k] = { thumb: v.thumb, uc: v.uc, ts: now }; });
           localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(merged));
         } catch (_) {}
         // Hide progress after completion of eager batch
         setLoadingBar({ active: false, mode: 'determinate', progress: 100 });

        // No viewport gating: everything requested eagerly for the current folder
      } catch (err) {
        console.warn('Preview prefetch error', err);
        setLoadingBar({ active: false, mode: 'determinate', progress: 0 });
      }
    })();
    return () => { cancelled = true; try { observerCleanup && observerCleanup(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingDrive, currentPathKey]);

  const localDir = getCurrentDirectory(localGalleryStructure || {}, path);
  const driveDir = getCurrentDirectory(driveStructure || {}, path);
  const currentDir = path.length === 0 ? (localDir || driveDir) : (driveDir || localDir);

  const entries = useMemo(() => {
    return Object.entries(currentDir || {}).sort(([a], [b]) => a.localeCompare(b));
  }, [currentDir]);

  const folders = useMemo(() => {
    return entries
      .filter(([, value]) => typeof value === 'object')
      .filter(([key]) => key.toLowerCase() !== 'slideshow');
  }, [entries]);

  // Safety guard: if after loading we have no folders/images at root,
  // force fallback to local assets (non-breaking for other pages)
  useEffect(() => {
    if (!isLoading && path.length === 0) {
      const hasContent = entries.length > 0;
      if (!hasContent) {
        const localRoot = getCurrentDirectory(localGalleryStructure || {}, []);
        const localHasContent = Object.keys(localRoot || {}).length > 0;
        if (localHasContent) {
          setActiveStructure(localGalleryStructure);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, path.length, activeStructure, entries.length]);

  // Progressive render images in a folder to improve perceived performance
  useEffect(() => {
    const total = images.length;
    setRenderCount(total > 0 ? 1 : 0);
    if (total <= 1) return;

    let idx = 1;
    const step = 4; // number of images to add per tick
    const intervalMs = 300;
    const timer = setInterval(() => {
      idx = Math.min(total, idx + step);
      setRenderCount(idx);
      if (idx >= total) {
        clearInterval(timer);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [images.length, currentPathKey]);
  useEffect(() => {
    const entries = Object.entries(currentDir || {}).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const imageEntries = entries.filter(([key, value]) => typeof value === 'string' && !['icon.jpg','icon.jpeg'].includes(key.toLowerCase()));
    setImages(imageEntries);
  }, [currentDir]);

  // Derive candidate URLs for Drive image IDs; prefer thumbnail first, then UC view
  const deriveDriveCandidates = (urlOrPath) => {
    if (typeof urlOrPath !== 'string') return [urlOrPath];
    // Local asset
    if (!urlOrPath.startsWith('http')) return [urlOrPath];
    // Try multiple patterns to extract a Google Drive file id
    let id = null;
    const byQuery = urlOrPath.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (byQuery) id = byQuery[1];
    if (!id) {
      const byPath = urlOrPath.match(/\/(?:file|u|drive)?\/d\/([A-Za-z0-9_-]+)/);
      if (byPath) id = byPath[1];
    }
    if (!id) return [urlOrPath];
    const uc = `https://drive.google.com/uc?export=view&id=${id}`;
    const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w512`;
    // Prefer thumbnail first for speed
    return [thumb, uc];
  };

  // Helper: extract a Drive ID for reliable matching across link variants
  const getDriveId = useCallback((urlOrPath) => {
    if (typeof urlOrPath !== 'string') return null;
    const q = urlOrPath.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (q) return q[1];
    const p = urlOrPath.match(/\/(?:file|u|drive)?\/d\/([A-Za-z0-9_-]+)/);
    if (p) return p[1];
    return null;
  }, []);

  const sameImage = useCallback((a, b) => {
    if (a === b) return true;
    const ia = getDriveId(a);
    const ib = getDriveId(b);
    if (ia && ib) return ia === ib;
    return false;
  }, [getDriveId]);

  // For overlay/full-view, prefer full-resolution download first, then UC view, then thumbnail
  const deriveOverlayCandidates = useCallback((urlOrPath) => {
    if (typeof urlOrPath !== 'string') return [urlOrPath];
    if (!urlOrPath.startsWith('http')) return [urlOrPath];

    // Try to extract Drive file id
    let id = null;
    const byQuery = urlOrPath.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (byQuery) id = byQuery[1];
    if (!id) {
      const byPath = urlOrPath.match(/\/(?:file|u|drive)?\/d\/([A-Za-z0-9_-]+)/);
      if (byPath) id = byPath[1];
    }

    if (id) {
      const dl = `https://drive.google.com/uc?export=download&id=${id}`;
      const view = `https://drive.google.com/uc?export=view&id=${id}`;
      const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w1024`;
      // Restore order: full-res download first, then view, then thumbnail
      return [dl, view, thumb];
    }

    // Fallback when no id could be parsed: revert to deriveDriveCandidates and reverse
    const c = deriveDriveCandidates(urlOrPath);
    // c is [thumb, uc]; for overlay prefer uc first
    if (c.length === 2) return [c[1], c[0]];
    return c;
  }, []);

  // Navigation functions
  // removed nav lock to avoid stuck state
  // const navLockRef = useRef(false);
  const navigateImage = useCallback((direction) => {
    if (!selectedImage || images.length === 0) return;
    // if (navLockRef.current) return; // prevent rapid multi-clicks while loading
    // navLockRef.current = true;

    // Always resolve index by matching the active image src to the current list.
    const currentIndex = images.findIndex(([fileName, imagePath]) => 
      sameImage(imagePath, selectedImage.src)
    );

    console.debug('[Galleries] navigateImage', { direction, currentIndex, imagesLen: images.length });

    let newIndex;

    if (currentIndex < 0) {
      newIndex = direction === 'next' ? 0 : images.length - 1;
    } else if (direction === 'next') {
      newIndex = (currentIndex + 1) % images.length;
    } else {
      newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
    }

    const [fileName, imagePath] = images[newIndex];

    // Prepare next state but keep current image visible until next preloads
    setNextOverlaySrc(null);
    setNextOverlayAlt(null);
    setNextReady(false);
    // Do NOT clear overlaySrc/Alt here; let the preload/crossfade effect handle the swap

    setSelectedIndex(newIndex);
    setSelectedImage({ src: imagePath, alt: '' });

    console.debug('[Galleries] nav set', { newIndex, fileName });
  }, [selectedImage, images, selectedIndex, sameImage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      console.debug('[Galleries] keydown', e.key);
      if (selectedImage) {
        if (e.key === 'ArrowLeft') {
          navigateImage('prev');
        } else if (e.key === 'ArrowRight') {
          navigateImage('next');
        } else if (e.key === 'Escape') {
          setSelectedImage(null);
          setSelectedIndex(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedImage, navigateImage]);

  const canNavigatePrev = selectedImage && images.length > 1;
  const canNavigateNext = selectedImage && images.length > 1;

  // Preload and crossfade overlay image to avoid ugly placeholders during navigation
  const [overlaySrc, setOverlaySrc] = useState(null);
  const [overlayAlt, setOverlayAlt] = useState(null);
  const [nextOverlaySrc, setNextOverlaySrc] = useState(null);
  const [nextOverlayAlt, setNextOverlayAlt] = useState(null);
  const [nextReady, setNextReady] = useState(false);
  const overlayPrefetchedRef = useRef(new Set());

  // Prefetch overlay preview URLs for all images in the current folder
  useEffect(() => {
    if (!images || images.length === 0) return;
    let cancelled = false;
    const queue = [];
    const limit = Math.min(images.length, OVERLAY_PREFETCH_LIMIT);
    for (let i = 0; i < limit; i++) {
      const path = images[i][1];
      const c = deriveOverlayCandidates(path);
      const preview = c[1] || c[0];
      if (preview && !overlayPrefetchedRef.current.has(preview)) {
        overlayPrefetchedRef.current.add(preview);
        queue.push(preview);
      }
    }
    let running = 0;
    const pump = () => {
      while (!cancelled && running < OVERLAY_PREFETCH_CONCURRENCY && queue.length > 0) {
        const url = queue.shift();
        running++;
        const img = new Image();
        img.onload = () => { running--; pump(); };
        img.onerror = () => { running--; pump(); };
        img.src = url;
      }
    };
    pump();
    return () => { cancelled = true; queue.length = 0; };
  }, [images, deriveOverlayCandidates]);
  useEffect(() => {
    if (!selectedImage) {
      setOverlaySrc(null);
      setOverlayAlt(null);
      setNextOverlaySrc(null);
      setNextOverlayAlt(null);
      setNextReady(false);
      // navLockRef.current = false; // reset lock when closing overlay
      return;
    }

    const cands = deriveOverlayCandidates(selectedImage.src);
    const full = cands[0];
    const preview = cands[1] || cands[0];
    const direct = selectedImage.src; // absolute fallback

    if (!overlaySrc) {
      // Initial open: only show an image after it has successfully loaded.
      let assigned = false;
      const tryLoad = (url, onReady) => {
        if (!url) return;
        const img = new Image();
        img.onload = () => onReady(url);
        img.onerror = () => {};
        img.src = url;
      };

      // Original order: try full first, then preview; show only once loaded
      tryLoad(full, (u) => {
        if (!assigned) {
          setOverlaySrc(u);
          setOverlayAlt(selectedImage.alt);
          assigned = true;
        } else if (overlaySrc === preview || overlaySrc === direct) {
          setNextOverlaySrc(u);
          setNextOverlayAlt(selectedImage.alt);
          setNextReady(true);
        }
      });

      tryLoad(preview, (u) => {
        if (!assigned) {
          setOverlaySrc(u);
          setOverlayAlt(selectedImage.alt);
          assigned = true;
        }
      });

      // As a last resort, try the original src
      tryLoad(direct, (u) => {
        if (!assigned) {
          setOverlaySrc(u);
          setOverlayAlt(selectedImage.alt);
          assigned = true;
        }
      });
    } else {
      // Navigation: race full and preview; show whichever loads first
      let assigned = false;
      const raceLoad = (url) => {
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          if (assigned) return;
          assigned = true;
          setNextOverlaySrc(url);
          setNextOverlayAlt(selectedImage.alt);
          setNextReady(true);
        };
        img.onerror = () => {};
        img.src = url;
      };
      raceLoad(full);
      raceLoad(preview);
      if (!full && !preview) {
        raceLoad(direct);
      }
    }

    // Prefetch neighbors at full resolution to make next/prev seamless
    const currentIndex = selectedIndex != null
      ? selectedIndex
      : images.findIndex(([fileName, imagePath]) => sameImage(imagePath, selectedImage.src));
    if (currentIndex !== -1) {
      const nextIndex = (currentIndex + 1) % images.length;
      const prevIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
      [images[nextIndex]?.[1], images[prevIndex]?.[1]].forEach((p) => {
        if (!p) return;
        const nc = deriveOverlayCandidates(p);
        const fullNext = nc[0];
        if (fullNext) {
          const pre = new Image();
          pre.src = fullNext;
        }
      });
    }
  }, [selectedImage, images, overlaySrc, selectedIndex, deriveOverlayCandidates, sameImage]);

  // Ensure swap finalizes even if CSS transition event is missed
  useEffect(() => {
    if (nextReady && nextOverlaySrc) {
      const timer = setTimeout(() => {
        setOverlaySrc(nextOverlaySrc);
        setOverlayAlt(nextOverlayAlt);
        setNextOverlaySrc(null);
        setNextOverlayAlt(null);
        setNextReady(false);
        // navLockRef.current = false; // unlock when swap completes
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [nextReady, nextOverlaySrc, nextOverlayAlt]);

  const breadcrumb = (
    <div className="breadcrumb">
      <span
        onClick={() => setPath([])}
        className="breadcrumb-segment breadcrumb-home"
      >
        Galleries
      </span>
      {path.map((segment, index) => (
        <span key={index}>
          <span className="breadcrumb-separator"> / </span>
          <span
            onClick={() => setPath(path.slice(0, index + 1))}
            className="breadcrumb-segment"
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="galleries-container">
      {path.length > 0 && breadcrumb}

      {loadingBar.active && (
        <div className={`loading-bar ${loadingBar.mode === 'indeterminate' ? 'indeterminate' : 'determinate'}`}>
          <div className="progress-track">
            <div className="progress-fill" style={loadingBar.mode === 'determinate' ? { width: `${loadingBar.progress}%` } : {}} />
          </div>
        </div>
      )}

      {isLoading && (
        <div className="image-grid" style={{ padding: '24px 0' }}>
          <div className="folder-placeholder" />
        </div>
      )}

      {!isLoading && folders.length > 0 && (
        <div className="folder-grid">
          {folders.map(([folderName, folderContent]) => {
            // First try to find a direct image in the folder
            const directImage = Object.entries(folderContent).find(
              ([name, value]) => typeof value === 'string'
            );
            
            // Prefer local icon.jpg for any depth (root or subfolders)
            const localPreview = getLocalIconForPath([...path, folderName]);
            const previewImageSrc = localPreview || (directImage ? directImage[1] : getRandomImageFromFolder(folderContent));

            const pathKey = [...path, folderName].join('/');
            const cachedPreview = folderPreviews[pathKey];
            const previewCandidates = localPreview
              ? [localPreview]
              : (cachedPreview 
                ? [cachedPreview?.thumb, cachedPreview?.uc].filter(Boolean)
                : deriveDriveCandidates(previewImageSrc));
            const initialPreviewSrc = previewCandidates[0];

            return (
              <div
                className="folder-card"
                data-pathkey={pathKey}
                key={folderName}
                onClick={() => setPath([...path, folderName])}
              >
                {initialPreviewSrc ? (
                  <img
                    src={initialPreviewSrc}
                    alt={folderName}
                    className="folder-preview"
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    onError={(e) => {
                      const cands = previewCandidates;
                      const current = e.target.src;
                      const next = current === cands[0] ? cands[1] : cands[2];
                      if (next) {
                        e.target.src = next;
                      } else {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                ) : (
                  <div className="folder-placeholder" />
                )}
                <div className="folder-label">{folderName}</div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && images.length > 0 && (
        <div className="image-grid">
          {images.slice(0, renderCount).map(([fileName, imagePath], idx) => (
            <div 
              className="image-card" 
              key={fileName}
              onClick={() => { setSelectedImage({ src: imagePath, alt: '' }); setSelectedIndex(idx); }}
            >
              {(() => {
                const cands = deriveDriveCandidates(imagePath);
                const initial = cands[0];
                return (
                  <img 
                    src={initial} 
                    alt="" 
                    className="gallery-image" 
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    loading="lazy"
                    onError={(e) => {
                      const current = e.target.src;
                      const next = current === cands[0] ? cands[1] : cands[2];
                      if (next) {
                        e.target.src = next;
                      } else {
                        e.target.style.display = 'none';
                      }
                    }}
                  />
                );
              })()}
            </div>
          ))}

          {/* Placeholders for images not yet rendered to keep layout stable */}
          {Array.from({ length: Math.max(0, images.length - renderCount) }).map((_, i) => (
            <div className="image-card" key={`placeholder-${i}`}>
              <div className="image-placeholder" />
            </div>
          ))}
        </div>
      )}

      {/* Prefetch a handful of images per top-level folder once Drive structure is ready */}
      {usingDrive && driveStructure && !hasPrefetched && (
        (() => {
          const limitPerFolder = 6;
          const prefetch = (src) => {
            const cands = deriveDriveCandidates(src);
            const img = new Image();
            img.src = cands[0];
          };
          Object.entries(driveStructure).forEach(([folderName, folderContent]) => {
            const imgs = collectImagesWithLimit(folderContent, limitPerFolder);
            imgs.forEach(prefetch);
          });
          setHasPrefetched(true);
          return null;
        })()
      )}

      {selectedImage && (
        <div className="image-overlay" onClick={() => { setSelectedImage(null); setSelectedIndex(null); }}>
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={() => { setSelectedImage(null); setSelectedIndex(null); }}>
              ×
            </button>
            
            {canNavigatePrev && (
              <button 
                className="nav-button nav-button-prev" 
                aria-label="Previous image"
                disabled={Boolean(nextOverlaySrc && !nextReady)}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('prev');
                }}
              >
                ‹
              </button>
            )}
            
            {canNavigateNext && (
              <button 
                className="nav-button nav-button-next" 
                aria-label="Next image"
                disabled={Boolean(nextOverlaySrc && !nextReady)}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('next');
                }}
              >
                ›
              </button>
            )}
            
            {(() => {
              const overlayCands = deriveOverlayCandidates(selectedImage.src);
              const overlayMatches = overlaySrc && sameImage(overlaySrc, selectedImage.src);
              const displaySrc = (overlaySrc && overlayMatches) ? overlaySrc : (overlayCands[1] || overlayCands[0] || null);
              const showSpinner = !displaySrc && !nextReady;
              const isNavLoading = Boolean(nextOverlaySrc && !nextReady);
              return (
                <div style={{position:'relative', width:'100%', height:'100%'}}>
                 {showSpinner && (
                   <div className="overlay-loading"><div className="spinner" /></div>
                 )}
                 {isNavLoading && (
                   <div className="overlay-progress indeterminate">
                     <div className="progress-track">
                       <div className="progress-fill" />
                     </div>
                   </div>
                 )}
                  {/* Current image (render only if we have a src) */}
                  {displaySrc && (
                    <img
                      src={displaySrc}
                      alt=""
                      className="overlay-image overlay-current"
                      onError={(e) => {
                        // Immediately hide browser broken icon
                        e.target.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                        // If current unexpectedly fails, try next candidate chain
                        const idx = overlayCands.indexOf(displaySrc);
                        const next = idx >= 0 ? overlayCands[idx + 1] : overlayCands[1];
                        const directFallback = selectedImage.src;
                        const chain = [next, directFallback].filter(Boolean);
                        let i = 0;
                        const tryNext = () => {
                          const url = chain[i++];
                          if (!url) return;
                          const img = new Image();
                          img.onload = () => setOverlaySrc(url);
                          img.onerror = tryNext;
                          img.src = url;
                        };
                        tryNext();
                      }}
                    />
                  )}

                  {/* Next image (preloaded then crossfaded) */}
                  {nextOverlaySrc && (
                    <img
                      src={nextOverlaySrc}
                      alt=""
                      className="overlay-image overlay-next"
                      style={{opacity: nextReady ? 1 : 0}}
                      onTransitionEnd={() => {
                        // finalize swap
                        setOverlaySrc(nextOverlaySrc);
                        setOverlayAlt(nextOverlayAlt);
                        setNextOverlaySrc(null);
                        setNextOverlayAlt(null);
                        setNextReady(false);
                        // navLockRef.current = false; // unlock after transition completes
                      }}
                      onError={(e) => {
                        // Immediately hide browser broken icon for the next image too
                        e.target.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                        // If next fails, try fallback candidate
                        const idx = overlayCands.indexOf(nextOverlaySrc);
                        const fallback = idx >= 0 ? overlayCands[idx + 1] : overlayCands[1];
                        const directFallback = selectedImage.src;
                        const chain = [fallback, directFallback].filter(Boolean);
                        let i = 0;
                        const tryNext = () => {
                          const url = chain[i++];
                          if (!url) {
                            // abandon next; keep current
                            setNextOverlaySrc(null);
                            setNextReady(false);
                            // navLockRef.current = false; // unlock if we abandon next
                            return;
                          }
                          const img = new Image();
                          img.onload = () => {
                            setNextOverlaySrc(url);
                            setNextReady(true);
                          };
                          img.onerror = tryNext;
                          img.src = url;
                        };
                        tryNext();
                      }}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export default Galleries;
