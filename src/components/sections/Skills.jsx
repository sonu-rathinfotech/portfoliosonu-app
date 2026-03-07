import { Box, Typography, Container, Grid, Chip, Stack } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { skills } from '../../data/portfolioData';
import { fadeInUp, scaleIn, staggerContainer } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

const MotionBox = motion.create(Box);
const MotionGrid = motion.create(Grid);

const categories = ['all', ...Object.keys(skills)];

function SkillCard({ skill }) {
  const Icon = skill.icon;
  return (
    <MotionBox
      variants={scaleIn}
      whileHover={{
        scale: 1.08,
        y: -5,
      }}
      sx={{ height: '100%' }}
    >
      <GlassCard
        hover
        sx={{
          p: 3,
          textAlign: 'center',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          '&:hover': {
            borderColor: `${skill.color}33`,
            boxShadow: `0 0 25px ${skill.color}15`,
          },
        }}
      >
        <Box
          sx={{
            width: 50,
            height: 50,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `${skill.color}15`,
            border: `1px solid ${skill.color}25`,
          }}
        >
          <Icon size={26} color={skill.color} />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {skill.name}
        </Typography>
      </GlassCard>
    </MotionBox>
  );
}

export default function Skills() {
  const [activeCategory, setActiveCategory] = useState('all');

  const getFilteredSkills = () => {
    if (activeCategory === 'all') {
      return Object.values(skills).flatMap((cat) => cat.items);
    }
    return skills[activeCategory]?.items || [];
  };

  const filteredSkills = getFilteredSkills();

  return (
    <Box
      id="skills"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="Tech Stack"
          subtitle="Technologies and tools I use to build reliable, scalable systems"
        />

        {/* Category filter tabs */}
        <MotionBox
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          sx={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
            mb: 6,
          }}
        >
          {categories.map((cat) => {
            const isActive = activeCategory === cat;
            const CategoryIcon = cat !== 'all' ? skills[cat]?.icon : null;
            return (
              <MotionBox key={cat} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Chip
                  icon={CategoryIcon ? <CategoryIcon size={14} /> : undefined}
                  label={cat === 'all' ? 'All' : skills[cat]?.title}
                  onClick={() => setActiveCategory(cat)}
                  sx={{
                    px: 2,
                    py: 2.5,
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    background: isActive
                      ? 'linear-gradient(135deg, #00C9A7, #6C63FF)'
                      : 'rgba(255,255,255,0.05)',
                    color: isActive ? '#fff' : 'text.secondary',
                    border: isActive
                      ? 'none'
                      : '1px solid rgba(255,255,255,0.1)',
                    '&:hover': {
                      background: isActive
                        ? 'linear-gradient(135deg, #00C9A7, #6C63FF)'
                        : 'rgba(255,255,255,0.1)',
                    },
                  }}
                />
              </MotionBox>
            );
          })}
        </MotionBox>

        {/* Skills grid */}
        <AnimatePresence mode="wait">
          <MotionGrid
            key={activeCategory}
            container
            spacing={2.5}
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {filteredSkills.map((skill) => (
              <Grid key={skill.name} size={{ xs: 6, sm: 4, md: 3, lg: 2.4 }}>
                <SkillCard skill={skill} />
              </Grid>
            ))}
          </MotionGrid>
        </AnimatePresence>
      </Container>
    </Box>
  );
}
