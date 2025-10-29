import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './Galleries.css';
import googleDriveService from '../services/googleDriveService';
import { ReactComponent as ShareIcon } from '../assets/icons/share.svg';
const PREVIEW_CACHE_KEY = 'folderPreviewCacheV2';
const PREVIEW_CACHE_TTL_MS = 1000 * 60 * 60 * 72; // 72 hours
const PREFETCH_CONCURRENCY = 4;   // concurrent preview fetches
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
  const navigate = useNavigate();
  const [images, setImages] = useState([]);

  // Reset path when navigating to galleries from other pages
  useEffect(() => {
    // Only reset if we're coming from a different page (not just refreshing)
    if (location.pathname === '/galleries' && location.state?.resetPath !== false) {
      setPath([]);
    }
  }, [location.pathname, location.state?.resetPath]);

  // Open to a shared folder path if provided via query param `p`
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const p = params.get('p');
    if (p != null) {
      const next = p.split('/').filter(Boolean);
      const nextKey = next.join('/');
      if (nextKey !== currentPathKey) {
        setPath(next);
      }
    }
  }, [location.search, currentPathKey]);

  // If a deep-link includes an id or a folder path, prefer Drive immediately
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const hasId = params.get('id');
    const hasP = params.get('p');
    if ((hasId || hasP) && !usingDrive) {
      setUsingDrive(true);
    }
  }, [location.search, usingDrive]);

  // Parse selectedIndex from URL immediately for deep-links
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const iParam = params.get('i');
    if (iParam == null) {
      setSelectedIndex(null);
      return;
    }
    const idx = parseInt(iParam, 10);
    if (!Number.isFinite(idx)) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex(idx);
  }, [location.search]);

  // Image open effect moved below getDriveId for correct initialization order
  // See effect after sameImage definition.

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

  // Once images are loaded, open the image; prefer stable id over index
  useEffect(() => {
    console.debug('[Galleries] open-by-param start', { imagesLen: images.length, selectedIndex, hasSelected: Boolean(selectedImage), search: location.search });
    if (images.length === 0) return;

    // Do not override when an image is already selected (e.g., via navigation)
    if (selectedImage) {
      console.debug('[Galleries] open-by-param skip: selectedImage already set');
      return;
    }

    const params = new URLSearchParams(location.search || '');
    const idParam = params.get('id');
    if (idParam) {
      const byIdIdx = images.findIndex(([fileName, imagePath]) => getDriveId(imagePath) === idParam);
      console.debug('[Galleries] open-by-param id match', { idParam, byIdIdx });
      if (byIdIdx >= 0) {
        const [, imagePath] = images[byIdIdx];
        console.debug('[Galleries] open-by-param set by id', { byIdIdx, imagePath });
        setSelectedIndex(byIdIdx);
        setSelectedImage({ src: imagePath, alt: '' });
        return; // id wins over i
      }
      // If an id param is present but not found yet, wait for next images update rather than falling back to index
      console.debug('[Galleries] open-by-param id not found; waiting for images to load');
      return;
    }

    // Only use index when no id is provided
    if (selectedIndex == null) return;
    if (selectedIndex < 0 || selectedIndex >= images.length) return;
    const [, imagePath] = images[selectedIndex];
    console.debug('[Galleries] open-by-param set by index', { selectedIndex, imagePath });
    setSelectedImage({ src: imagePath, alt: '' });
  }, [images, selectedIndex, selectedImage, location.search, getDriveId, sameImage]);

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
      const view = `https://drive.google.com/uc?export=view&id=${id}`;
      const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w1024`;
      const dl = `https://drive.google.com/uc?export=download&id=${id}`;
      // Prefer view, then thumbnail; download last (often 403 without cookies)
      return [view, thumb, dl];
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
    console.debug('[Galleries] navigateImage start', { direction, hasSelected: Boolean(selectedImage), imagesLen: images.length, selectedIndex });
    if (!selectedImage) {
      console.debug('[Galleries] navigateImage bail: no selectedImage');
      return;
    }
  
    // For deep-links, we might not have images array populated yet, but we have selectedIndex from URL
    if (images.length === 0 && selectedIndex == null) {
      console.debug('[Galleries] navigateImage bail: no images and no selectedIndex');
      return;
    }
  
    let currentIndex = (selectedIndex != null)
      ? selectedIndex
      : images.findIndex(([fileName, imagePath]) => sameImage(imagePath, selectedImage.src));
    if (currentIndex < 0) currentIndex = 0;
  
    let newIndex;
    if (images.length > 0) {
      // Normal case: use images array length for wrapping
      if (direction === 'next') {
        newIndex = (currentIndex + 1) % images.length;
      } else {
        newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
      }
      console.debug('[Galleries] navigateImage computed newIndex', { newIndex });
    } else {
      // Deep-link case: navigate based on selectedIndex even without images array
      if (direction === 'next') {
        newIndex = currentIndex + 1;
      } else {
        newIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }
      console.debug('[Galleries] navigateImage deep-link URL update', { newIndex });
      // Update URL to trigger image loading
      const params = new URLSearchParams(location.search);
      params.set('i', newIndex.toString());
      window.history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
      return;
    }
  
    const [, imagePath] = images[newIndex];
  
    // Immediately show the preview candidate of the next image
    const cands = deriveOverlayCandidates(imagePath);
    const preview = cands[1] || cands[0] || imagePath;
    console.debug('[Galleries] navigateImage set overlay preview', { preview });
    setOverlaySrc(preview);
    setOverlayAlt('');
  
    // Reset next state for crossfade preloading
    setNextOverlaySrc(null);
    setNextOverlayAlt(null);
    setNextReady(false);
  
    setSelectedIndex(newIndex);
    setSelectedImage({ src: imagePath, alt: '' });

    // Keep the URL in sync so deep-link effect won’t override selection
    try {
      const params = new URLSearchParams(location.search || '');
      params.set('i', String(newIndex));
      const newId = getDriveId(imagePath);
      if (newId) params.set('id', newId);
      window.history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
    } catch {}
  }, [selectedImage, images, selectedIndex, sameImage, deriveOverlayCandidates, location, getDriveId]);

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
          console.debug('[Galleries] escape key pressed');
          setSelectedImage(null);
          setSelectedIndex(null);
          // Clear URL params when closing via Escape key too
          const params = new URLSearchParams(location.search);
          if (params.has('id') || params.has('i')) {
            console.debug('[Galleries] escape close: clearing URL params');
            const p = params.get('p') || currentPathKey;
            const to = p ? `${location.pathname}?p=${encodeURIComponent(p)}` : location.pathname;
            navigate(to, { replace: true });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedImage, navigateImage, location.pathname, location.search, currentPathKey, navigate]);

  // Always enable navigation when an image is selected - deep-links may open overlay before images array is populated
  const canNavigatePrev = Boolean(selectedImage);
  const canNavigateNext = Boolean(selectedImage);

  // Preload and crossfade overlay image to avoid ugly placeholders during navigation
  const [overlaySrc, setOverlaySrc] = useState(null);
  const [overlayAlt, setOverlayAlt] = useState(null);
  const [nextOverlaySrc, setNextOverlaySrc] = useState(null);
  const [nextOverlayAlt, setNextOverlayAlt] = useState(null);
  const [nextReady, setNextReady] = useState(false);
  // Share modal state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const overlayPrefetchedRef = useRef(new Set());

  // Share helpers
  const getShareLink = useCallback(() => {
    // Build a site URL that reproduces the current folder and image selection
    try {
      const basePath = process.env.NODE_ENV === 'production' && window.location.hostname.includes('github.io') ? '/vineeth-photography' : '';
      const url = new URL(`${basePath}/galleries`, window.location.origin);
      const pKey = path.join('/');
      if (pKey) url.searchParams.set('p', pKey);
      const idx = selectedIndex != null
        ? selectedIndex
        : images.findIndex(([fileName, imagePath]) => sameImage(imagePath, selectedImage?.src));
      if (idx != null && idx >= 0) {
        url.searchParams.set('i', String(idx));
        const driveId = getDriveId(images[idx]?.[1]);
        if (driveId) url.searchParams.set('id', driveId);
      }
      return url.toString();
    } catch (e) {
      const basePath = process.env.NODE_ENV === 'production' && window.location.hostname.includes('github.io') ? '/vineeth-photography' : '';
      return window.location.origin + `${basePath}/galleries`;
    }
  }, [path, selectedIndex, images, selectedImage, sameImage, getDriveId]);

  const openShare = useCallback(() => {
    if (!selectedImage) return;
    const link = getShareLink();
    setShareUrl(link);
    setShareOpen(true);
    setCopied(false);
  }, [selectedImage, getShareLink]);

  const closeShare = useCallback(() => {
    setShareOpen(false);
    setCopied(false);
  }, []);

  const copyShareUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      // Fallback approach
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); setCopied(true); } catch {}
      document.body.removeChild(textarea);
      setTimeout(() => setCopied(false), 1400);
    }
  }, [shareUrl]);

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
        // eslint-disable-next-line no-loop-func
        img.onload = () => { running--; pump(); };
        // eslint-disable-next-line no-loop-func
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

      // Prefer preview (uc?view) first; download can 403
      tryLoad(preview, (u) => {
        if (!assigned) {
          setOverlaySrc(u);
          setOverlayAlt(selectedImage.alt);
          assigned = true;
        }
      });

      // Then attempt full-res download (may fail); if it succeeds, upgrade
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

      // As a last resort, try the original src
      tryLoad(direct, (u) => {
        if (!assigned) {
          setOverlaySrc(u);
          setOverlayAlt(selectedImage.alt);
          assigned = true;
        }
      });
    } else {
      // Navigation: prefer preview race, then fallback to direct; avoid download-first
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
      raceLoad(preview);
      raceLoad(full); // try upgrade if it loads
      if (!preview && !full) {
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
        // Prefetch the preview (uc?view) which is reliably accessible
        const previewNext = nc[0];
        if (previewNext) {
          const pre = new Image();
          pre.src = previewNext;
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
        <div className="image-overlay" onClick={() => { 
          console.debug('[Galleries] overlay background clicked');
          setSelectedImage(null); 
          setSelectedIndex(null);
          // Clear URL params when closing via background click too
          const params = new URLSearchParams(location.search);
          if (params.has('id') || params.has('i')) {
            console.debug('[Galleries] overlay close: clearing URL params');
            const p = params.get('p') || currentPathKey;
            const to = p ? `${location.pathname}?p=${encodeURIComponent(p)}` : location.pathname;
            navigate(to, { replace: true });
          }
        }}>
          <div className="overlay-content" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="close-button" onPointerUp={(e) => { 
              console.debug('[Galleries] close button clicked', { hasSelectedImage: Boolean(selectedImage), currentPath: location.pathname, currentSearch: location.search });
              e.stopPropagation(); 
              setSelectedImage(null); 
              setSelectedIndex(null);
              // When opened via shared URL, navigate back to gallery root to ensure proper state
              const params = new URLSearchParams(location.search);
              if (params.has('id') || params.has('i')) {
                console.debug('[Galleries] close: clearing URL params and navigating to gallery view');
                const p = params.get('p') || currentPathKey;
                const to = p ? `${location.pathname}?p=${encodeURIComponent(p)}` : location.pathname;
                navigate(to, { replace: true });
              }
            }}>
              ×
            </button>
            
            {canNavigatePrev && (
              <button 
                type="button"
                className="nav-button nav-button-prev" 
                aria-label="Previous image"
                onPointerUp={(e) => {
                  console.debug('[Galleries] prev pointerup');
                  e.stopPropagation();
                  navigateImage('prev');
                }}
              >
                ‹
              </button>
            )}
            
            {canNavigateNext && (
              <button 
                type="button"
                className="nav-button nav-button-next" 
                aria-label="Next image"
                onPointerUp={(e) => {
                  console.debug('[Galleries] next pointerup');
                  e.stopPropagation();
                  navigateImage('next');
                }}
              >
                ›
              </button>
            )}
            
            {(() => {
              const overlayCands = deriveOverlayCandidates(selectedImage.src);
              // Always prefer overlaySrc when present; avoid strict matching that can fail on URL variants
              const displaySrc = overlaySrc || overlayCands[1] || overlayCands[0] || null;
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
                      alt={overlayAlt || ''}
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
                      alt={nextOverlayAlt || ''}
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

            <div className="overlay-footer">
               <button type="button" className="share-button" aria-label="Share" onClick={(e) => { e.stopPropagation(); openShare(); }}>
                 <ShareIcon className="share-icon" />
               </button>
             </div>

            {shareOpen && (
              <div className="share-modal" onClick={(e) => e.stopPropagation()}>
                <div className="share-modal-header">Share this image</div>
                <div className="share-modal-body">
                  <input type="text" readOnly value={shareUrl} className="share-url-input" onFocus={(e)=>e.target.select()} />
                  <button type="button" className="copy-button" onClick={copyShareUrl}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
                <div className="share-modal-actions">
                  <button type="button" className="close-share" onClick={closeShare}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Galleries;
