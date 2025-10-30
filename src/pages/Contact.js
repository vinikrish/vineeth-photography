import React, { useState, useRef } from 'react';
import emailjs from '@emailjs/browser';
import './Galleries.css';
import './Contact.css';

function Contact() {
  const [formData, setFormData] = useState({
    user_name: '',
    user_email: '',
    message: ''
  });

  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitting(true);

    emailjs
      .sendForm(
        process.env.REACT_APP_EMAILJS_SERVICE_ID,
        process.env.REACT_APP_EMAILJS_TEMPLATE_ID,
        formRef.current,
        process.env.REACT_APP_EMAILJS_PUBLIC_KEY
      )
      .then(() => {
        setSuccess(true);
        setFormData({ user_name: '', user_email: '', message: '' });
        setSubmitting(false);
        setTimeout(() => setSuccess(false), 5000);
      })
      .catch((err) => {
        console.error('EmailJS Error:', err);
        alert('Something went wrong. Please try again.');
        setSubmitting(false);
      });
  };

  return (
    <div className="contact-page">
      <p className="contact-subtext">I value your thoughts and feedback.</p>
      <p className="contact-subtext">
        Please feel free to reach out using the form below. I will respond in a timely manner.
      </p>

      <form ref={formRef} onSubmit={handleSubmit} className="contact-form">
        <label>Your Name:</label>
        <input
          type="text"
          name="user_name"
          value={formData.user_name}
          onChange={handleChange}
          required
          disabled={submitting}
        />

        <label>Your Email Address:</label>
        <input
          type="email"
          name="user_email"
          value={formData.user_email}
          onChange={handleChange}
          required
          disabled={submitting}
        />

        <label>Your Message:</label>
        <textarea
          name="message"
          value={formData.message}
          onChange={handleChange}
          required
          rows="5"
          disabled={submitting}
        ></textarea>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send'}
        </button>

        {success && <p className="success-message">Your message was sent successfully!</p>}
      </form>
    </div>
  );
}

export default Contact;
