import React, { useState } from 'react';

function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });

  const handleChange = e => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = e => {
    e.preventDefault();
    alert('Message sent successfully!');
    setFormData({ name: '', email: '', message: '' });
  };

  return (
    <div>
      <h2>Contact Vineeth</h2>
      <p>I value your thoughts and feedback.</p>
      <p>Please feel free to reach out using the form below — I’ll respond in a timely and professional manner.</p>
      <form onSubmit={handleSubmit} style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'left' }}>
        <label>Your Name:</label>
        <input type="text" name="name" value={formData.name} onChange={handleChange} required style={{ width: '100%', padding: '8px', margin: '8px 0' }} />

        <label>Your Email Address:</label>
        <input type="email" name="email" value={formData.email} onChange={handleChange} required style={{ width: '100%', padding: '8px', margin: '8px 0' }} />

        <label>Your Message:</label>
        <textarea name="message" value={formData.message} onChange={handleChange} required rows="5" style={{ width: '100%', padding: '8px', margin: '8px 0' }}></textarea>

        <button type="submit" style={{ padding: '10px 20px', background: '#444', color: '#fff', border: 'none', cursor: 'pointer' }}>Send</button>
      </form>
    </div>
  );
}

export default Contact;
