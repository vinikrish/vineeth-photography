import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Footer from './Footer';
import './Layout.css';

function Layout() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { isDarkMode } = useTheme();

  // Use theme-specific PNG images
  const coverImage = isDarkMode ? 'new_Cover_Dark.png' : 'new_Cover_Light.png';

  return (
    <div className="layout-wrapper">
      <div
        className="cover-image"
        style={{
          backgroundImage: `url(${process.env.PUBLIC_URL}/images/${coverImage})`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '80% auto',
          height: '70px',
          width: '100%',
          opacity: '0.8',
          maxWidth: '400px',
          margin: '0 auto',
        }}
      />
      <header className="site-header">
        <h1>Vineeth Radhakrishnan Photography</h1>
        <nav className="navbar">
          <Link to="/" className={currentPath === '/' ? 'active-link' : ''}>Home</Link>
          <Link to="/bio" className={currentPath === '/bio' ? 'active-link' : ''}>Bio</Link>
          <Link to="/galleries" className={currentPath.startsWith('/galleries') ? 'active-link' : ''}>Galleries</Link>
          <Link to="/contact" className={currentPath === '/contact' ? 'active-link' : ''}>Contact</Link>
        </nav>
      </header>

      <div className="main-content">
        <Outlet />
      </div>

      <Footer />
    </div>
  );
}

export default Layout;
