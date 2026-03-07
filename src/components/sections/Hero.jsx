import { Box, Typography, Button, Container, Stack, Chip } from '@mui/material';
import { motion } from 'framer-motion';
import { TypeAnimation } from 'react-type-animation';
import { FaDownload, FaArrowRight, FaEnvelope } from 'react-icons/fa';
import { personalInfo, heroTechStack } from '../../data/portfolioData';
import { fadeInUp, staggerContainer } from '../../data/animations';

const MotionBox = motion.create(Box);
const MotionTypography = motion.create(Typography);
const MotionButton = motion.create(Button);

function NetworkBackground() {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {/* Gradient orbs */}
      <MotionBox
        animate={{
          y: [0, -30, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        sx={{
          position: 'absolute',
          top: '10%',
          right: '10%',
          width: { xs: 200, md: 400 },
          height: { xs: 200, md: 400 },
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,201,167,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <MotionBox
        animate={{
          y: [0, 20, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        sx={{
          position: 'absolute',
          bottom: '10%',
          left: '5%',
          width: { xs: 200, md: 350 },
          height: { xs: 200, md: 350 },
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(108,99,255,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <MotionBox
        animate={{
          y: [0, -20, 0],
          x: [0, 15, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: { xs: 150, md: 300 },
          height: { xs: 150, md: 300 },
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,166,35,0.1) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Grid pattern */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Animated data flow lines */}
      {[...Array(5)].map((_, i) => (
        <MotionBox
          key={i}
          animate={{
            x: ['-100%', '200%'],
            opacity: [0, 0.6, 0],
          }}
          transition={{
            duration: 4 + i * 1.5,
            repeat: Infinity,
            delay: i * 2,
            ease: 'linear',
          }}
          sx={{
            position: 'absolute',
            top: `${15 + i * 18}%`,
            left: 0,
            width: { xs: 80, md: 150 },
            height: 1,
            background: `linear-gradient(90deg, transparent, ${
              ['#00C9A7', '#6C63FF', '#F5A623', '#3B82F6', '#10B981'][i]
            }, transparent)`,
          }}
        />
      ))}
    </Box>
  );
}

export default function Hero() {
  return (
    <Box
      id="home"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        pt: { xs: 10, md: 0 },
      }}
    >
      <NetworkBackground />

      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <MotionBox
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* Greeting */}
          <MotionTypography
            variants={fadeInUp}
            sx={{
              color: '#00C9A7',
              fontWeight: 600,
              fontSize: { xs: '0.9rem', md: '1.1rem' },
              letterSpacing: 3,
              textTransform: 'uppercase',
              mb: 2,
            }}
          >
            Welcome to my portfolio
          </MotionTypography>

          {/* Name */}
          <MotionTypography
            variants={fadeInUp}
            variant="h1"
            sx={{
              fontSize: { xs: '2.5rem', sm: '3.5rem', md: '4.5rem', lg: '5rem' },
              fontWeight: 900,
              lineHeight: 1.1,
              mb: 2,
              background: 'linear-gradient(135deg, #F1F5F9 0%, #00C9A7 50%, #6C63FF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {personalInfo.name}
          </MotionTypography>

          {/* Typing animation */}
          <MotionBox variants={fadeInUp} sx={{ mb: 3, minHeight: 40 }}>
            <TypeAnimation
              sequence={[
                'Backend Engineer',
                2000,
                'Banking Systems Specialist',
                2000,
                'API Architect',
                2000,
                'System Design Enthusiast',
                2000,
              ]}
              wrapper="span"
              speed={50}
              repeat={Infinity}
              style={{
                fontSize: 'clamp(1.2rem, 3vw, 1.8rem)',
                fontWeight: 600,
                color: '#6C63FF',
                fontFamily: '"Fira Code", monospace',
              }}
            />
          </MotionBox>

          {/* Tagline */}
          <MotionTypography
            variants={fadeInUp}
            variant="h5"
            color="text.secondary"
            sx={{
              maxWidth: 600,
              fontSize: { xs: '1rem', md: '1.2rem' },
              lineHeight: 1.8,
              mb: 4,
            }}
          >
            {personalInfo.description}
          </MotionTypography>

          {/* CTA Buttons */}
          <MotionBox variants={fadeInUp}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 5 }}>
              <MotionButton
                whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(0,201,167,0.3)' }}
                whileTap={{ scale: 0.95 }}
                variant="contained"
                size="large"
                href="#projects"
                endIcon={<FaArrowRight />}
                sx={{
                  background: 'linear-gradient(135deg, #00C9A7, #00A389)',
                  px: 4,
                  py: 1.5,
                  fontSize: '1rem',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #00D4B0, #00C9A7)',
                  },
                }}
              >
                View Projects
              </MotionButton>
              <MotionButton
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                variant="outlined"
                size="large"
                startIcon={<FaDownload />}
                sx={{
                  borderColor: 'rgba(108,99,255,0.5)',
                  color: '#6C63FF',
                  px: 4,
                  py: 1.5,
                  fontSize: '1rem',
                  '&:hover': {
                    borderColor: '#6C63FF',
                    background: 'rgba(108,99,255,0.08)',
                  },
                }}
              >
                Download Resume
              </MotionButton>
              <MotionButton
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                variant="outlined"
                size="large"
                href="#contact"
                startIcon={<FaEnvelope />}
                sx={{
                  borderColor: 'rgba(245,166,35,0.5)',
                  color: '#F5A623',
                  px: 4,
                  py: 1.5,
                  fontSize: '1rem',
                  '&:hover': {
                    borderColor: '#F5A623',
                    background: 'rgba(245,166,35,0.08)',
                  },
                }}
              >
                Contact Me
              </MotionButton>
            </Stack>
          </MotionBox>

          {/* Tech Stack Icons */}
          <MotionBox variants={fadeInUp}>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                Tech Stack:
              </Typography>
              {heroTechStack.map((tech) => (
                <MotionBox
                  key={tech.name}
                  whileHover={{ scale: 1.2, y: -4 }}
                  sx={{ cursor: 'pointer' }}
                >
                  <Chip
                    icon={<tech.icon style={{ color: tech.color }} />}
                    label={tech.name}
                    size="small"
                    sx={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'text.secondary',
                      '&:hover': {
                        background: 'rgba(255,255,255,0.1)',
                        borderColor: tech.color,
                      },
                    }}
                  />
                </MotionBox>
              ))}
            </Stack>
          </MotionBox>
        </MotionBox>
      </Container>

      {/* Scroll indicator */}
      <MotionBox
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        sx={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Scroll Down
        </Typography>
        <Box
          sx={{
            width: 24,
            height: 40,
            border: '2px solid rgba(255,255,255,0.2)',
            borderRadius: 12,
            display: 'flex',
            justifyContent: 'center',
            pt: 1,
          }}
        >
          <MotionBox
            animate={{ y: [0, 12, 0], opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            sx={{
              width: 4,
              height: 8,
              borderRadius: 2,
              background: '#00C9A7',
            }}
          />
        </Box>
      </MotionBox>
    </Box>
  );
}
