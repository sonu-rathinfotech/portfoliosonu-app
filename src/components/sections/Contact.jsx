import { Box, Typography, Container, Grid, TextField, Button, Stack, IconButton } from '@mui/material';
import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  FaEnvelope, FaMapMarkerAlt, FaCheckCircle,
  FaGithub, FaLinkedin, FaTwitter, FaPaperPlane,
} from 'react-icons/fa';
import { personalInfo } from '../../data/portfolioData';
import { fadeInUp, fadeInLeft, fadeInRight } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

const MotionBox = motion.create(Box);
const MotionButton = motion.create(Button);

const socialLinks = [
  { icon: FaGithub, url: personalInfo.github, label: 'GitHub', color: '#F1F5F9' },
  { icon: FaLinkedin, url: personalInfo.linkedin, label: 'LinkedIn', color: '#0A66C2' },
  { icon: FaEnvelope, url: `mailto:${personalInfo.email}`, label: 'Email', color: '#00C9A7' },
];

const inputSx = {
  '& .MuiOutlinedInput-root': {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 2,
    color: '#F1F5F9',
    '& fieldset': {
      borderColor: 'rgba(255,255,255,0.1)',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(255,255,255,0.2)',
    },
    '&.Mui-focused fieldset': {
      borderColor: '#00C9A7',
    },
  },
  '& .MuiInputLabel-root': {
    color: '#94A3B8',
    '&.Mui-focused': {
      color: '#00C9A7',
    },
  },
};

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // In production, this would send to a backend API
    console.log('Contact form submitted:', formData);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
    setFormData({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <Box
      id="contact"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="Get In Touch"
          subtitle="Have a project in mind or want to discuss opportunities? Let's connect."
        />

        <Grid container spacing={6}>
          {/* Left - Info */}
          <Grid size={{ xs: 12, md: 5 }}>
            <MotionBox
              variants={fadeInLeft}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
                Let's work together
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, lineHeight: 1.8 }}>
                I'm always interested in discussing new engineering challenges,
                backend architecture, and opportunities in fintech or enterprise systems.
              </Typography>

              {/* Contact info */}
              <Stack spacing={3} sx={{ mb: 4 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(0,201,167,0.1)',
                      border: '1px solid rgba(0,201,167,0.2)',
                    }}
                  >
                    <FaEnvelope size={18} color="#00C9A7" />
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Email</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {personalInfo.email}
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(108,99,255,0.1)',
                      border: '1px solid rgba(108,99,255,0.2)',
                    }}
                  >
                    <FaMapMarkerAlt size={18} color="#6C63FF" />
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Location</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {personalInfo.location}
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(16,185,129,0.1)',
                      border: '1px solid rgba(16,185,129,0.2)',
                    }}
                  >
                    <FaCheckCircle size={18} color="#10B981" />
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Availability</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#10B981' }}>
                      Open for opportunities
                    </Typography>
                  </Box>
                </Stack>
              </Stack>

              {/* Social links */}
              <Stack direction="row" spacing={1.5}>
                {socialLinks.map((social) => (
                  <MotionBox
                    key={social.label}
                    whileHover={{ scale: 1.1, y: -3 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <IconButton
                      component="a"
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={social.label}
                      sx={{
                        width: 48,
                        height: 48,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'text.secondary',
                        '&:hover': {
                          background: `${social.color}15`,
                          borderColor: `${social.color}40`,
                          color: social.color,
                        },
                      }}
                    >
                      <social.icon size={20} />
                    </IconButton>
                  </MotionBox>
                ))}
              </Stack>
            </MotionBox>
          </Grid>

          {/* Right - Form */}
          <Grid size={{ xs: 12, md: 7 }}>
            <MotionBox
              variants={fadeInRight}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              <GlassCard sx={{ p: { xs: 3, md: 4 } }}>
                <Box component="form" onSubmit={handleSubmit}>
                  <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Your Name"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        sx={inputSx}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Email Address"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        sx={inputSx}
                      />
                    </Grid>
                    <Grid size={12}>
                      <TextField
                        fullWidth
                        label="Subject"
                        name="subject"
                        value={formData.subject}
                        onChange={handleChange}
                        sx={inputSx}
                      />
                    </Grid>
                    <Grid size={12}>
                      <TextField
                        fullWidth
                        label="Your Message"
                        name="message"
                        multiline
                        rows={5}
                        value={formData.message}
                        onChange={handleChange}
                        required
                        sx={inputSx}
                      />
                    </Grid>
                    <Grid size={12}>
                      <MotionButton
                        whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(0,201,167,0.3)' }}
                        whileTap={{ scale: 0.98 }}
                        type="submit"
                        variant="contained"
                        fullWidth
                        size="large"
                        endIcon={submitted ? <FaCheckCircle /> : <FaPaperPlane />}
                        sx={{
                          background: submitted
                            ? 'linear-gradient(135deg, #10B981, #059669)'
                            : 'linear-gradient(135deg, #00C9A7, #6C63FF)',
                          py: 1.5,
                          fontSize: '1rem',
                          fontWeight: 600,
                          '&:hover': {
                            background: submitted
                              ? 'linear-gradient(135deg, #10B981, #059669)'
                              : 'linear-gradient(135deg, #00D4B0, #7C73FF)',
                          },
                        }}
                      >
                        {submitted ? 'Message Sent!' : 'Send Message'}
                      </MotionButton>
                    </Grid>
                  </Grid>
                </Box>
              </GlassCard>
            </MotionBox>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
