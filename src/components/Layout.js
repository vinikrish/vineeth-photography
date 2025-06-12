import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import Footer from './Footer';
import './Layout.css';

function Layout() {
  return (
    <div className="layout-wrapper">
      {/* Cover image */}
      <div
        className="cover-image"
        style={{
          backgroundImage: `url(${process.env.PUBLIC_URL}/images/cover.jpg)`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          height: '100px',
          width: '100%',
        }}
      />

      {/* Header */}
      <header className="site-header">
        <h1>Vineeth Radhakrishnan Photography</h1>
        <nav className="navbar">
          <Link to="/">Home</Link>
          <Link to="/bio">Bio</Link>
          <Link to="/galleries">Galleries</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </header>

      {/* Main slideshow */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default Layout;
