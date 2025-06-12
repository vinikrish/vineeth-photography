import React, { useEffect, useState } from 'react';
import './Home.css';

function importAll(r) {
  return r.keys().map((key) => ({
    src: r(key),
    name: key.replace('./', '').replace(/\.[^/.]+$/, '') // for future use
  }));
}

const images = importAll(require.context('../assets/slideshow', false, /\.(png|jpe?g|webp)$/));

function Home() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 2000); // 2 seconds

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="slideshow-container">
      {images.map((image, index) => (
        <img
          key={index}
          src={image.src}
          alt=""
          className={`slideshow-image ${index === currentIndex ? 'active' : ''}`}
        />
      ))}
    </div>
  );
}

export default Home;
