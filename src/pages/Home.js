import React, { useEffect, useState, useCallback } from 'react';
import './Home.css';
import googleDriveService from '../services/googleDriveService';

function importAll(r) {
  return r.keys().map((key) => ({
    src: r(key),
    name: key.replace('./', '').replace(/\.[^/.]+$/, '') // for future use
  }));
}

// Local fallback images
const localImages = importAll(require.context('../assets/slideshow', false, /\.(png|jpe?g|webp)$/));

// Shuffle function to randomize array order
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function Home() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState(localImages); // Start with local images
  const [isLoading, setIsLoading] = useState(true);
  const [usingGoogleDrive, setUsingGoogleDrive] = useState(false);

  // Fullscreen overlay state
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlaySrc, setOverlaySrc] = useState(null);
  const [overlayAlt, setOverlayAlt] = useState('');
  const [overlayCandidates, setOverlayCandidates] = useState([]);
  const [overlayReady, setOverlayReady] = useState(false);

  const deriveOverlayCandidates = useCallback((image) => {
    if (!image) return [];
    // For Drive, prefer uc view first, then high-res thumbnail
    if (usingGoogleDrive) {
      const uc = image.ucUrl || image.src;
      const thumb = image.thumbnailUrl;
      return [uc, thumb].filter(Boolean);
    }
    // Local image
    return [image.src].filter(Boolean);
  }, [usingGoogleDrive]);

  const openOverlay = useCallback((image) => {
    const cands = deriveOverlayCandidates(image);
    setOverlayCandidates(cands);
    setOverlaySrc(null);
    setOverlayAlt(image.alt || image.name || '');
    setOverlayReady(false);
    setOverlayOpen(true);
    // Preload first candidate, fallback to next if it fails
    let i = 0;
    const tryNext = () => {
      const url = cands[i++];
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        setOverlaySrc(url);
        setOverlayReady(true);
      };
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();
  }, [deriveOverlayCandidates]);

  useEffect(() => {
    const loadImages = async () => {
      try {
        setIsLoading(true);
        
        // Try to load images from Google Drive
        const driveImages = await googleDriveService.getSlideshowImages();
        
        if (driveImages && driveImages.length > 0) {
          // Resolve to the first successfully loading URL per image
          const attemptLoad = (src) => new Promise((resolve) => {
            if (!src) return resolve(false);
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
          });

          const resolveImage = async (image) => {
            const candidates = [image.src, image.ucUrl, image.thumbnailUrl].filter(Boolean);
            for (const candidate of candidates) {
              const ok = await attemptLoad(candidate);
              if (ok) {
                return { ...image, src: candidate };
              }
            }
            return null;
          };

          // Limit resolution to first 12 images to avoid overwhelming the browser
          const toResolve = driveImages.slice(0, 12);
          const resolved = (await Promise.all(toResolve.map(resolveImage))).filter(Boolean);

          if (resolved.length > 0) {
            console.log(`Using Google Drive images (${resolved.length}/${toResolve.length} loaded)`);
            setImages(shuffleArray(resolved));
            setUsingGoogleDrive(true);
          } else {
            console.warn('No Drive images loaded; falling back to local');
            setImages(shuffleArray(localImages));
            setUsingGoogleDrive(false);
          }
        } else {
          // Fallback to local images
          setImages(shuffleArray(localImages));
          setUsingGoogleDrive(false);
          console.log('Using local images for slideshow (randomized order, Google Drive unavailable)');
        }
      } catch (error) {
        console.error('Error loading slideshow images:', error);
        // Fallback to local images on error
        setImages(shuffleArray(localImages));
        setUsingGoogleDrive(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadImages();
  }, []);

  useEffect(() => {
    if (images.length === 0) return;

    let timer;
    
    // Small delay to ensure first image loads properly
    const initialDelay = setTimeout(() => {
      timer = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % images.length);
      }, 3000); // 3 seconds
    }, 500); // 500ms initial delay

    return () => {
      clearTimeout(initialDelay);
      if (timer) clearInterval(timer);
    };
  }, [images.length]);

  // Close overlay with Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && overlayOpen) {
        setOverlayOpen(false);
        setOverlaySrc(null);
        setOverlayReady(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen]);

  if (isLoading) {
    return (
      <div className="slideshow-container">
        <div className="slideshow-loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="slideshow-container">
        <div className="slideshow-error">
          <p>No images available for slideshow</p>
        </div>
      </div>
    );
  }

  return (
    <div className="slideshow-container">
      {images.map((image, index) => {
        const isActive = index === currentIndex;
        const isPrevious = index === (currentIndex - 1 + images.length) % images.length;
        
        return (
          <img
            key={usingGoogleDrive ? image.id : index}
            src={image.src}
            alt={image.alt || image.name || ''}
            className={`slideshow-image ${isActive ? 'active' : ''} ${isPrevious ? 'previous' : ''}`}
            onError={(e) => {
              console.error('Failed to load image:', image.src);
              // Ordered fallbacks: uc view -> thumbnail
              if (usingGoogleDrive) {
                if (image.ucUrl && e.target.src === image.src) {
                  console.log('Retrying with uc view:', image.ucUrl);
                  e.target.src = image.ucUrl;
                  return;
                }
                if (image.thumbnailUrl && (e.target.src === image.ucUrl || e.target.src === image.src)) {
                  console.log('Retrying with thumbnail:', image.thumbnailUrl);
                  e.target.src = image.thumbnailUrl;
                  return;
                }
              }
              // Hide if fallback also fails
              e.target.style.display = 'none';
            }}
            onClick={() => openOverlay(image)}
          />
        );
      })}

      {overlayOpen && (
        <div className="home-overlay" onClick={() => { setOverlayOpen(false); setOverlaySrc(null); setOverlayReady(false); }}>
          <div className="home-overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="home-close-button" aria-label="Close" onClick={() => { setOverlayOpen(false); setOverlaySrc(null); setOverlayReady(false); }}>
              ×
            </button>
            {(!overlayReady) && (
              <div className="home-overlay-loading"><div className="spinner" /></div>
            )}
            {overlaySrc && (
              <img
                src={overlaySrc}
                alt={overlayAlt}
                className="home-overlay-image"
                onError={(e) => {
                  // Hide broken icon immediately
                  e.target.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  // Try next candidate
                  const idx = overlayCandidates.indexOf(overlaySrc);
                  const next = idx >= 0 ? overlayCandidates[idx + 1] : overlayCandidates[1];
                  let i = overlayCandidates.indexOf(next);
                  const tryNext = () => {
                    const url = overlayCandidates[i++];
                    if (!url) return;
                    const img = new Image();
                    img.onload = () => { setOverlaySrc(url); setOverlayReady(true); };
                    img.onerror = tryNext;
                    img.src = url;
                  };
                  tryNext();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
