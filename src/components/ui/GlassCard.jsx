import { Box } from '@mui/material';
import { motion } from 'framer-motion';

const MotionBox = motion.create(Box);

export default function GlassCard({ children, sx, hover = true, glow = false, ...props }) {
  return (
    <MotionBox
      whileHover={hover ? { y: -4, transition: { duration: 0.3 } } : undefined}
      sx={{
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        ...(hover && {
          '&:hover': {
            background: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            boxShadow: glow
              ? '0 0 30px rgba(0, 201, 167, 0.15), inset 0 0 30px rgba(0, 201, 167, 0.03)'
              : '0 20px 60px rgba(0, 0, 0, 0.3)',
          },
        }),
        ...sx,
      }}
      {...props}
    >
      {children}
    </MotionBox>
  );
}
