import { Box, Typography, Container, Stack, IconButton, Divider } from '@mui/material';
import { motion } from 'framer-motion';
import { FaGithub, FaLinkedin, FaEnvelope, FaHeart } from 'react-icons/fa';
import { personalInfo } from '../../data/portfolioData';

const MotionBox = motion.create(Box);

const socialLinks = [
  { icon: FaGithub, url: personalInfo.github, label: 'GitHub' },
  { icon: FaLinkedin, url: personalInfo.linkedin, label: 'LinkedIn' },
  { icon: FaEnvelope, url: `mailto:${personalInfo.email}`, label: 'Email' },
];

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        py: 4,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10, 14, 23, 0.8)',
      }}
    >
      <Container maxWidth="lg">
        <Stack alignItems="center" spacing={3}>
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
                  size="small"
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: '#00C9A7' },
                  }}
                >
                  <social.icon size={18} />
                </IconButton>
              </MotionBox>
            ))}
          </Stack>

          {/* Divider */}
          <Box
            sx={{
              width: 60,
              height: 2,
              background: 'linear-gradient(90deg, #00C9A7, #6C63FF)',
              borderRadius: 1,
            }}
          />

          {/* Copyright */}
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            &copy; {new Date().getFullYear()} {personalInfo.name}. All rights reserved.
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            Designed & Built with <FaHeart size={12} color="#00C9A7" /> using React & Material UI
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
