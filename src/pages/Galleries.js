import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import './Galleries.css';

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

const galleryStructure = importAll(
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

function Galleries() {
  const [path, setPath] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const location = useLocation();

  // Reset path when navigating to galleries from other pages
  useEffect(() => {
    // Only reset if we're coming from a different page (not just refreshing)
    if (location.pathname === '/galleries' && location.state?.resetPath !== false) {
      setPath([]);
    }
  }, [location.pathname, location.state?.resetPath]);

  const currentDir = getCurrentDirectory(galleryStructure, path);

  const entries = Object.entries(currentDir || {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const folders = entries.filter(([key, value]) => typeof value === 'object');
  const images = entries.filter(([key, value]) => typeof value === 'string');

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

      {folders.length > 0 && (
        <div className="folder-grid">
          {folders.map(([folderName, folderContent]) => {
            // First try to find a direct image in the folder
            const directImage = Object.entries(folderContent).find(
              ([name, value]) => typeof value === 'string'
            );
            
            // If no direct image, use the recursive function to find a random image from subfolders
            const previewImageSrc = directImage ? directImage[1] : getRandomImageFromFolder(folderContent);

            return (
              <div
                className="folder-card"
                key={folderName}
                onClick={() => setPath([...path, folderName])}
              >
                {previewImageSrc ? (
                  <img
                    src={previewImageSrc}
                    alt={folderName}
                    className="folder-preview"
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

      {images.length > 0 && (
        <div className="image-grid">
          {images.map(([fileName, imagePath]) => (
            <div 
              className="image-card" 
              key={fileName}
              onClick={() => setSelectedImage({ src: imagePath, alt: fileName })}
            >
              <img src={imagePath} alt={fileName} className="gallery-image" />
            </div>
          ))}
        </div>
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
            
            <img 
              src={selectedImage.src} 
              alt={selectedImage.alt} 
              className="overlay-image"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Galleries;
