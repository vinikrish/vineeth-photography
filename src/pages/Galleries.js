import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import './Galleries.css';
import googleDriveService from '../services/googleDriveService';

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
  
  function collectImages(obj) {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === 'string') {
        // This is an image file
        allImages.push(value);
      } else if (typeof value === 'object') {
        // This is a subfolder, recurse into it
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
  if (!obj || acc.length >= limit) return acc;
  for (const [key, value] of Object.entries(obj)) {
    if (acc.length >= limit) break;
    if (typeof value === 'string') {
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

function Galleries() {
  const [path, setPath] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [activeStructure, setActiveStructure] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [renderCount, setRenderCount] = useState(0); // progressive grid rendering
  const [driveStructure, setDriveStructure] = useState(null);
  const [usingDrive, setUsingDrive] = useState(false);
  const [hasPrefetched, setHasPrefetched] = useState(false);
  const [folderPreviews, setFolderPreviews] = useState({});
  const location = useLocation();

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
            setUsingDrive(true);
          }
        } catch (_) {}

        // Fetch fresh Drive structure
        const driveTree = await googleDriveService.getDriveGalleryStructure();
        if (!cancelled && driveTree && Object.keys(driveTree).length > 0) {
          setDriveStructure(driveTree);
          try {
            sessionStorage.setItem('driveGalleryStructure', JSON.stringify(driveTree));
          } catch (_) {}
          setActiveStructure(driveTree);
          setUsingDrive(true);
        } else if (!cancelled) {
          // Fallback: if full tree fails, ensure we at least have Drive root listing
          if (!driveStructure) {
            const rootFolders = await googleDriveService.getGalleryFolders();
            if (rootFolders && rootFolders.length > 0) {
              const minimalDrive = {};
              for (const f of rootFolders) {
                if ((f.name || '').toLowerCase() === 'slideshow') continue; // safety
                minimalDrive[f.name] = {};
              }
              setDriveStructure(minimalDrive);
              setUsingDrive(true);
            }
          }
        }
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
        const folderId = await googleDriveService.resolveFolderIdByPath(path);
        if (!folderId) return;
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
      } catch (err) {
        console.warn('Failed to progressively load Drive folder', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join('/'), usingDrive]);

  // Prefetch fast preview thumbnails for immediate subfolders on navigation
  useEffect(() => {
    if (!usingDrive) return;
    let cancelled = false;
    (async () => {
      try {
        const parentId = await googleDriveService.resolveFolderIdByPath(path);
        if (!parentId) return;
        const subs = await googleDriveService.getSubfolders(parentId);
        const cacheRaw = sessionStorage.getItem('folderPreviewCache');
        const cache = cacheRaw ? JSON.parse(cacheRaw) : {};
        const basePath = path.join('/');
        const toFetch = [];
        const updates = {};
        for (const s of subs) {
          const key = `${basePath}/${s.name}`;
          if (cache && cache[key]) {
            updates[key] = cache[key];
          } else {
            toFetch.push({ key, id: s.id });
          }
        }
        const limit = 8;
        let i = 0;
        async function worker() {
          while (i < toFetch.length) {
            const idx = i++;
            const { key, id } = toFetch[idx];
            // Use deep preview search to handle folders with images in subfolders
            const file = await googleDriveService.getFirstImageInTree(id, 2);
            if (file) {
              updates[key] = { thumb: file.thumbUrl, uc: file.ucUrl };
            } else {
              updates[key] = { thumb: null, uc: null };
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, toFetch.length) }, () => worker()));
        if (cancelled) return;
        setFolderPreviews(prev => ({ ...prev, ...updates }));
        try {
          sessionStorage.setItem('folderPreviewCache', JSON.stringify({ ...(cache || {}), ...updates }));
        } catch (_) {}
      } catch (err) {
        console.warn('Preview prefetch error', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingDrive, path.join('/')]);

  const localDir = getCurrentDirectory(localGalleryStructure || {}, path);
  const driveDir = getCurrentDirectory(driveStructure || {}, path);
  const currentDir = path.length === 0 ? (localDir || driveDir) : (driveDir || localDir);

  const entries = Object.entries(currentDir || {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

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
  }, [isLoading, path.length, activeStructure]);

  const folders = entries
    .filter(([key, value]) => typeof value === 'object')
    // Safety: exclude any folder named 'slideshow'
    .filter(([key]) => key.toLowerCase() !== 'slideshow');
  const images = entries.filter(([key, value]) => typeof value === 'string');

  // Progressively render images in a folder to improve perceived performance
  useEffect(() => {
    // Reset when navigating or when image set changes
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
    // Depend on images length and path to restart on navigation
  }, [images.length, path.join('/')]);

  // Derive candidate URLs for Drive image IDs; prefer thumbnail first, then UC view
  const deriveDriveCandidates = (urlOrPath) => {
    if (typeof urlOrPath !== 'string') return [urlOrPath];
    // Local asset
    if (!urlOrPath.startsWith('http')) return [urlOrPath];
    // Extract id from known patterns
    const idMatch = urlOrPath.match(/id=([A-Za-z0-9_-]+)/);
    const id = idMatch ? idMatch[1] : null;
    if (!id) return [urlOrPath];
    const uc = `https://drive.google.com/uc?export=view&id=${id}`;
    const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w1024`;
    // Prefer thumbnail first for speed
    return [thumb, uc];
  };

  // For overlay/full-view, prefer UC first for quality, then thumbnail
  const deriveOverlayCandidates = (urlOrPath) => {
    const c = deriveDriveCandidates(urlOrPath);
    // c is [thumb, uc]; reverse preference for overlay
    if (c.length === 2) return [c[1], c[0]];
    return c;
  };

  // Navigation functions
  const navigateImage = useCallback((direction) => {
    if (!selectedImage || images.length === 0) return;

    const currentIndex = images.findIndex(([fileName, imagePath]) => imagePath === selectedImage.src);
    let newIndex;

    if (direction === 'next') {
      newIndex = (currentIndex + 1) % images.length;
    } else {
      newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
    }

    const [fileName, imagePath] = images[newIndex];
    setSelectedImage({ src: imagePath, alt: fileName });
  }, [selectedImage, images]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (selectedImage) {
        if (e.key === 'ArrowLeft') {
          navigateImage('prev');
        } else if (e.key === 'ArrowRight') {
          navigateImage('next');
        } else if (e.key === 'Escape') {
          setSelectedImage(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedImage, navigateImage]);

  const canNavigatePrev = selectedImage && images.length > 1;
  const canNavigateNext = selectedImage && images.length > 1;

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
            
            // Prefer local assets for root folder icons for instant render
            const localPreview = path.length === 0 ? getLocalPreviewForFolder(folderName) : null;
            const previewImageSrc = localPreview || (directImage ? directImage[1] : getRandomImageFromFolder(folderContent));

            const pathKey = [...path, folderName].join('/');
            const cachedPreview = folderPreviews[pathKey];
            const previewCandidates = cachedPreview 
              ? [cachedPreview?.thumb, cachedPreview?.uc].filter(Boolean)
              : deriveDriveCandidates(previewImageSrc);
            const initialPreviewSrc = previewCandidates[0];

            return (
              <div
                className="folder-card"
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
                    loading="lazy"
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
          {images.slice(0, renderCount).map(([fileName, imagePath]) => (
            <div 
              className="image-card" 
              key={fileName}
              onClick={() => setSelectedImage({ src: imagePath, alt: fileName })}
            >
              {(() => {
                const cands = deriveDriveCandidates(imagePath);
                const initial = cands[0];
                return (
                  <img 
                    src={initial} 
                    alt={fileName} 
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
        <div className="image-overlay" onClick={() => setSelectedImage(null)}>
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={() => setSelectedImage(null)}>
              ×
            </button>
            
            {canNavigatePrev && (
              <button 
                className="nav-button nav-button-prev" 
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
              const initialOverlay = overlayCands[0];
              return (
                <img 
                  src={initialOverlay} 
                  alt={selectedImage.alt} 
                  className="overlay-image"
                  onError={(e) => {
                    const current = e.target.src;
                    const next = current === overlayCands[0] ? overlayCands[1] : overlayCands[2];
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
        </div>
      )}
    </div>
  );
}

export default Galleries;
