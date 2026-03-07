import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { fadeInUp } from '../../data/animations';

const MotionBox = motion.create(Box);

export default function SectionHeading({ title, subtitle }) {
  return (
    <MotionBox
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}
    >
      <Typography
        variant="h3"
        sx={{
          fontSize: { xs: '1.8rem', md: '2.5rem' },
          fontWeight: 800,
          background: 'linear-gradient(135deg, #00C9A7 0%, #6C63FF 50%, #F5A623 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          mb: 2,
        }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          width: 60,
          height: 4,
          background: 'linear-gradient(90deg, #00C9A7, #6C63FF)',
          borderRadius: 2,
          mx: 'auto',
          mb: subtitle ? 2 : 0,
        }}
      />
      {subtitle && (
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}
        >
          {subtitle}
        </Typography>
      )}
    </MotionBox>
  );
}
