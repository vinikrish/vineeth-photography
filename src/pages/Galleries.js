import React, { useState, useEffect } from 'react';
import './Galleries.css';

function importAll(r) {
  const files = {};
  r.keys().forEach((key) => {
    const cleanedKey = key.replace('./', '');
    files[cleanedKey] = r(key);
  });
  return files;
}

const images = importAll(require.context('../assets/galleries', true, /\.(jpg|jpeg)$/));

function buildFileTree(files) {
  const tree = {};
  for (const path in files) {
    const parts = path.split('/');
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = files[path];
      } else {
        current[part] = current[part] || {};
        current = current[part];
      }
    }
  }
  return tree;
}

function getSubtree(tree, path) {
  const parts = path.split('/').filter(Boolean);
  let current = tree;
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

function findFirstImage(obj) {
  if (typeof obj !== 'object') return null;
  for (const key in obj) {
    if (typeof obj[key] === 'string' && key.toLowerCase().endsWith('.jpg')) {
      return obj[key];
    } else if (typeof obj[key] === 'object') {
      const found = findFirstImage(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

const Galleries = () => {
  const tree = buildFileTree(images);
  const [path, setPath] = useState('');
  const [popupImage, setPopupImage] = useState(null);
  const [slideshowImages, setSlideshowImages] = useState([]);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [showSlideshow, setShowSlideshow] = useState(false);

  const current = getSubtree(tree, path);
  const breadcrumbs = path.split('/').filter(Boolean);

  useEffect(() => {
    if (!path) return;
    const currentFolder = getSubtree(tree, path);
    const images = Object.keys(currentFolder || {})
      .filter((k) => k.toLowerCase().endsWith('.jpg'))
      .map((img) => currentFolder[img]);
    setSlideshowImages(images);
    setSlideshowIndex(0);
  }, [path]);

  return (
    <div className="galleries-container">
      <h2 className="galleries-title">Galleries</h2>
      {breadcrumbs.length > 0 && (
        <div className="breadcrumbs">
          {breadcrumbs.map((crumb, idx) => (
            <span key={idx} onClick={() => setPath(breadcrumbs.slice(0, idx + 1).join('/'))}>
              {crumb}
              {idx < breadcrumbs.length - 1 && ' / '}
            </span>
          ))}
        </div>
      )}
      {slideshowImages.length > 0 && (
        <div className="slideshow-link" onClick={() => setShowSlideshow(true)}>View Slideshow</div>
      )}
      <div className="grid">
        {Object.entries(current || {}).map(([name, value]) => {
          if (typeof value === 'string' && name.toLowerCase().endsWith('.jpg')) {
            return (
              <div key={name} className="image-card" onClick={() => setPopupImage(value)}>
                <img src={value} alt="" className="thumbnail" />
              </div>
            );
          } else if (typeof value === 'object') {
            const preview = findFirstImage(value);
            return (
              <div key={name} className="folder-card" onClick={() => setPath(path ? `${path}/${name}` : name)}>
                {preview && <img src={preview} alt={name} className="folder-preview" />}
                <div className="folder-label">{name}</div>
              </div>
            );
          }
          return null;
        })}
      </div>

      {popupImage && (
        <div className="overlay" onClick={() => setPopupImage(null)}>
          <img src={popupImage} alt="" className="popup-img" />
          <button className="close-btn" onClick={() => setPopupImage(null)}>×</button>
        </div>
      )}

      {showSlideshow && slideshowImages.length > 0 && (
        <div className="overlay">
          <img src={slideshowImages[slideshowIndex]} alt="" className="popup-img" />
          <button className="close-btn" onClick={() => setShowSlideshow(false)}>×</button>
          <button className="nav-btn left" onClick={() => setSlideshowIndex((slideshowIndex - 1 + slideshowImages.length) % slideshowImages.length)}>‹</button>
          <button className="nav-btn right" onClick={() => setSlideshowIndex((slideshowIndex + 1) % slideshowImages.length)}>›</button>
        </div>
      )}
    </div>
  );
};

export default Galleries;