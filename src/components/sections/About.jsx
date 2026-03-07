import { Box, Typography, Container, Grid } from '@mui/material';
import { motion, useInView } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';
import { aboutData } from '../../data/portfolioData';
import { fadeInUp, fadeInLeft, fadeInRight } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

const MotionBox = motion.create(Box);

function CounterStat({ value, label }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);
  const numericValue = parseInt(value);

  useEffect(() => {
    if (isInView && !isNaN(numericValue)) {
      let start = 0;
      const increment = numericValue / 30;
      const timer = setInterval(() => {
        start += increment;
        if (start >= numericValue) {
          setCount(numericValue);
          clearInterval(timer);
        } else {
          setCount(Math.floor(start));
        }
      }, 40);
      return () => clearInterval(timer);
    }
  }, [isInView, numericValue]);

  const displayValue = isNaN(numericValue) ? value : `${count}${value.replace(/\d+/, '')}`;

  return (
    <Box ref={ref} sx={{ textAlign: 'center' }}>
      <Typography
        variant="h3"
        sx={{
          fontWeight: 800,
          fontSize: { xs: '2rem', md: '2.5rem' },
          background: 'linear-gradient(135deg, #00C9A7, #6C63FF)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {displayValue}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

export default function About() {
  return (
    <Box
      id="about"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="About Me"
          subtitle="Mission-critical systems engineer with a passion for building secure, scalable infrastructure"
        />

        <Grid container spacing={6} alignItems="center">
          {/* Left - Visual / Stats */}
          <Grid size={{ xs: 12, md: 5 }}>
            <MotionBox
              variants={fadeInLeft}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              <GlassCard
                glow
                sx={{
                  p: 4,
                  background: 'linear-gradient(135deg, rgba(0,201,167,0.05) 0%, rgba(108,99,255,0.05) 100%)',
                }}
              >
                <Grid container spacing={3}>
                  {aboutData.highlights.map((stat) => (
                    <Grid size={6} key={stat.label}>
                      <CounterStat value={stat.value} label={stat.label} />
                    </Grid>
                  ))}
                </Grid>
              </GlassCard>
            </MotionBox>
          </Grid>

          {/* Right - Description */}
          <Grid size={{ xs: 12, md: 7 }}>
            <MotionBox
              variants={fadeInRight}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              <Typography
                variant="body1"
                color="text.secondary"
                sx={{ mb: 3, fontSize: { xs: '1rem', md: '1.1rem' }, lineHeight: 1.8 }}
              >
                {aboutData.summary}
              </Typography>
              <Typography
                variant="body1"
                color="text.secondary"
                sx={{ fontSize: { xs: '1rem', md: '1.1rem' }, lineHeight: 1.8 }}
              >
                {aboutData.description2}
              </Typography>

              {/* Accent line */}
              <Box
                sx={{
                  mt: 4,
                  p: 3,
                  borderLeft: '3px solid #00C9A7',
                  background: 'rgba(0,201,167,0.05)',
                  borderRadius: '0 12px 12px 0',
                }}
              >
                <Typography variant="body2" sx={{ color: '#00C9A7', fontStyle: 'italic' }}>
                  "I believe in building systems that are not just functional, but resilient —
                  systems that handle edge cases gracefully and scale without breaking trust."
                </Typography>
              </Box>
            </MotionBox>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
