import React from 'react';
import './Contact.css';
import './About.css';
import profilePhoto from '../assets/profile-photo-for-bio.jpg';

function About() {
  return (
    <div className="contact-container">
      {/* Profile Photo Section */}
      <div className="profile-photo-section">
        <div className="profile-photo-container">
          <img 
            src={profilePhoto} 
            alt="Vineeth Radhakrishnan - Wildlife and Landscape Photographer" 
            className="profile-photo"
          />
        </div>
      </div>
      
      <div className="contact-description centered-text">
        <p>
          Vineeth Radhakrishnan is a nature photographer who has been capturing the extraordinary beauty of the natural world for over eight years. He has traveled extensively across the United States, seeking out perfect moments, from the intricate details of macro insects to the vast expanse of the Milky Way stretching across dark skies.
        </p>
        <p>
          His photography journey spans diverse subjects: the graceful flight of birds, the fascinating world of macro insects with their extraordinary details and hidden beauty, the mesmerizing patterns of deep space, the raw power of waterfalls, the gentle flow of mountain streams, and the breathtaking vistas of untouched landscapes. Each photograph tells a story of patience, dedication, and an unwavering love for the natural world.
        </p>

        <p>Vineeth’s work has been published internationally, with features in:</p>
        <ul style={{ textAlign: 'left', display: 'inline-block' }}>
          <li>Texas Parks and Wildlife (USA) — 3 times</li>
          <li>Mathrubhumi Online (India) — 4 times</li>
          <li>Wild Planet Magazine (UK) — 2 times</li>
          <li>Mathrubhumi Yathra (India)</li>
        </ul>

        <p>
          Thank you for joining in this visual journey through nature’s most captivating moments.
        </p>
      </div>
    </div>
  );
}

export default About;
