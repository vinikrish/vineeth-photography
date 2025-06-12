import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import Galleries from './pages/Galleries';

import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/bio" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/galleries" element={<Galleries />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
