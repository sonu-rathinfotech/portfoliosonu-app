import { useState, useEffect } from 'react';
import {
  AppBar, Toolbar, Typography, Box, IconButton,
  Drawer, List, ListItem, ListItemText, Container, Stack,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { FaBars, FaTimes } from 'react-icons/fa';
import { navLinks, personalInfo } from '../../data/portfolioData';

const MotionBox = motion.create(Box);
const MotionAppBar = motion.create(AppBar);

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('home');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);

      // Active section detection
      const sections = navLinks.map((link) => link.href.replace('#', ''));
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i]);
        if (el && el.getBoundingClientRect().top <= 150) {
          setActiveSection(sections[i]);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (href) => {
    setMobileOpen(false);
    const id = href.replace('#', '');
    const el = document.getElementById(id);
    if (el) {
      const navbarHeight = 80;
      const top = el.getBoundingClientRect().top + window.scrollY - navbarHeight;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <>
      <MotionAppBar
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        position="fixed"
        elevation={0}
        sx={{
          background: scrolled
            ? 'rgba(10, 14, 23, 0.85)'
            : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled
            ? '1px solid rgba(255,255,255,0.06)'
            : 'none',
          transition: 'all 0.3s ease',
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ justifyContent: 'space-between', py: 1 }}>
            {/* Logo */}
            <MotionBox
              whileHover={{ scale: 1.05 }}
              onClick={() => handleNavClick('#home')}
              sx={{ cursor: 'pointer' }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  fontSize: '1.3rem',
                  background: 'linear-gradient(135deg, #00C9A7, #6C63FF)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  letterSpacing: '-0.02em',
                }}
              >
                {'<Sonu />'}
              </Typography>
            </MotionBox>

            {/* Desktop nav */}
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ display: { xs: 'none', md: 'flex' } }}
            >
              {navLinks.map((link) => {
                const isActive = activeSection === link.href.replace('#', '');
                return (
                  <MotionBox
                    key={link.label}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Box
                      onClick={() => handleNavClick(link.href)}
                      sx={{
                        px: 2,
                        py: 1,
                        borderRadius: 2,
                        fontSize: '0.85rem',
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? '#00C9A7' : 'text.secondary',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          color: '#00C9A7',
                          background: 'rgba(0,201,167,0.08)',
                        },
                        '&::after': isActive ? {
                          content: '""',
                          position: 'absolute',
                          bottom: 0,
                          left: '30%',
                          right: '30%',
                          height: 2,
                          background: 'linear-gradient(90deg, #00C9A7, #6C63FF)',
                          borderRadius: 1,
                        } : {},
                      }}
                    >
                      {link.label}
                    </Box>
                  </MotionBox>
                );
              })}
            </Stack>

            {/* Mobile hamburger */}
            <IconButton
              onClick={() => setMobileOpen(!mobileOpen)}
              sx={{
                display: { md: 'none' },
                color: 'text.primary',
              }}
              aria-label="Toggle navigation menu"
            >
              {mobileOpen ? <FaTimes /> : <FaBars />}
            </IconButton>
          </Toolbar>
        </Container>
      </MotionAppBar>

      {/* Mobile drawer */}
      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        PaperProps={{
          sx: {
            width: 280,
            background: 'rgba(10, 14, 23, 0.95)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
          },
        }}
      >
        <Box sx={{ p: 3 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 800,
              mb: 4,
              background: 'linear-gradient(135deg, #00C9A7, #6C63FF)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {'<Sonu />'}
          </Typography>

          <List>
            {navLinks.map((link) => {
              const isActive = activeSection === link.href.replace('#', '');
              return (
                <ListItem
                  key={link.label}
                  onClick={() => handleNavClick(link.href)}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    cursor: 'pointer',
                    background: isActive ? 'rgba(0,201,167,0.1)' : 'transparent',
                    borderLeft: isActive ? '3px solid #00C9A7' : '3px solid transparent',
                    '&:hover': {
                      background: 'rgba(255,255,255,0.05)',
                    },
                  }}
                >
                  <ListItemText
                    primary={link.label}
                    primaryTypographyProps={{
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? '#00C9A7' : 'text.secondary',
                      fontSize: '0.95rem',
                    }}
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Drawer>
    </>
  );
}
