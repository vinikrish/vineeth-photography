import React, { useEffect, useState } from 'react';
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

function Home() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState(localImages); // Start with local images
  const [isLoading, setIsLoading] = useState(true);
  const [usingGoogleDrive, setUsingGoogleDrive] = useState(false);

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
              // Ordered fallbacks: alt=media -> uc view -> thumbnail
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
          />
        );
      })}
    </div>
  );
}

export default Home;
