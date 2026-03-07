import { Box } from '@mui/material';
import { motion } from 'framer-motion';
import { fadeInUp } from '../../data/animations';

const MotionBox = motion.create(Box);

export default function AnimatedSection({ children, variants = fadeInUp, delay = 0, sx, ...props }) {
  return (
    <MotionBox
      variants={{
        ...variants,
        visible: {
          ...variants.visible,
          transition: {
            ...variants.visible.transition,
            delay,
          },
        },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      sx={sx}
      {...props}
    >
      {children}
    </MotionBox>
  );
}
