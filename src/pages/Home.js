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
          setImages(shuffleArray(driveImages));
          setUsingGoogleDrive(true);
          console.log('Using Google Drive images for slideshow (randomized order)');
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
              // Hide broken images
              e.target.style.display = 'none';
            }}
          />
        );
      })}
    </div>
  );
}

export default Home;
