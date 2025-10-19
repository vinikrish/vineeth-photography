import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Disable right-click (context menu) globally
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Block common shortcuts: Save, DevTools, View Source
  window.addEventListener(
    'keydown',
    (e) => {
      const key = (e.key || '').toLowerCase();
      const ctrl = e.ctrlKey;
      const meta = e.metaKey; // Cmd on macOS
      const alt = e.altKey; // Option on macOS / Alt on Windows
      const shift = e.shiftKey;

      // Save: Ctrl/Cmd+S
      if ((ctrl || meta) && key === 's') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // DevTools: F12 or Ctrl+Shift+I or Cmd+Option+I
      if (
        key === 'f12' ||
        (ctrl && shift && key === 'i') ||
        (meta && alt && key === 'i')
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // View Source: Ctrl+U or Cmd+Option+U
      if ((ctrl && key === 'u') || (meta && alt && key === 'u')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true }
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
