import React from 'react';
import './Footer.css';
import { FaInstagram, FaYoutube, FaFacebook } from 'react-icons/fa';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="social-icons">
        <a href="https://www.instagram.com/vinikrish" target="_blank" rel="noreferrer"><FaInstagram /></a>
        <a href="https://www.youtube.com/@vinikrish" target="_blank" rel="noreferrer"><FaYoutube /></a>
        <a href="https://www.facebook.com/vinikrish" target="_blank" rel="noreferrer"><FaFacebook /></a>
      </div>
    </footer>
  );
};

export default Footer;
