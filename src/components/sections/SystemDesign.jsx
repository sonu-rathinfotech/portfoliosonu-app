import { Box, Typography, Container, Grid, Chip, Stack } from '@mui/material';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { FaBookOpen, FaArrowDown } from 'react-icons/fa';
import { systemDesignChapters, systemDesignSteps } from '../../data/portfolioData';
import { fadeInUp, scaleIn, staggerContainer } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';
import BookReader from '../ui/BookReader';
import ReadingGate, { useReadingGate } from '../ui/ReadingGate';

const MotionBox = motion.create(Box);
const MotionGrid = motion.create(Grid);

function ChapterCard({ chapter, onOpen }) {
  return (
    <MotionBox
      variants={scaleIn}
      whileHover={{ y: -6, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onOpen(chapter)}
      sx={{ height: '100%', cursor: 'pointer' }}
    >
      <GlassCard
        hover
        glow
        sx={{
          p: 2.5,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: `3px solid ${chapter.color}`,
          background: `linear-gradient(135deg, ${chapter.color}06 0%, transparent 100%)`,
          transition: 'all 0.3s ease',
          '&:hover': {
            borderColor: chapter.color,
            boxShadow: `0 0 30px ${chapter.color}20`,
            background: `linear-gradient(135deg, ${chapter.color}10 0%, transparent 100%)`,
          },
          '&:hover .chapter-read': {
            opacity: 1,
            transform: 'translateX(0)',
          },
        }}
      >
        {/* Chapter number + Icon */}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ fontSize: '1.5rem' }}>{chapter.icon}</Box>
            <Chip
              label={`Ch ${chapter.id}`}
              size="small"
              sx={{
                background: `${chapter.color}18`,
                color: chapter.color,
                border: `1px solid ${chapter.color}30`,
                fontWeight: 700,
                fontSize: '0.7rem',
                height: 22,
              }}
            />
          </Stack>
          <Chip
            label={`${chapter.topics} topics`}
            size="small"
            sx={{
              background: 'rgba(255,255,255,0.05)',
              color: 'text.secondary',
              fontSize: '0.65rem',
              height: 20,
            }}
          />
        </Stack>

        {/* Title */}
        <Typography
          variant="body1"
          sx={{ fontWeight: 700, mb: 0.5, fontSize: '0.95rem', lineHeight: 1.3 }}
        >
          {chapter.title}
        </Typography>

        {/* Subtitle */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: '0.78rem', lineHeight: 1.5, flex: 1 }}
        >
          {chapter.subtitle}
        </Typography>

        {/* Read CTA */}
        <Stack
          className="chapter-read"
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{
            mt: 1.5,
            pt: 1.5,
            borderTop: `1px solid ${chapter.color}15`,
            color: chapter.color,
            opacity: 0.6,
            transform: 'translateX(-5px)',
            transition: 'all 0.3s ease',
          }}
        >
          <FaBookOpen size={12} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Open & Read
          </Typography>
        </Stack>
      </GlassCard>
    </MotionBox>
  );
}

function ArchitectureDiagram() {
  return (
    <MotionBox
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        mb: 8,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 700,
          mb: 4,
          color: 'text.secondary',
          textAlign: 'center',
        }}
      >
        How Banking Systems Work — A Simplified Architecture
      </Typography>

      {systemDesignSteps.map((step, index) => (
        <Box key={step.label} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <GlassCard
            hover
            sx={{
              px: { xs: 3, md: 5 },
              py: 1.5,
              textAlign: 'center',
              borderLeft: `3px solid ${step.color}`,
              minWidth: { xs: 260, md: 400 },
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 700, color: step.color, fontSize: '0.9rem' }}>
              {step.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {step.description}
            </Typography>
          </GlassCard>
          {index < systemDesignSteps.length - 1 && (
            <MotionBox
              animate={{ y: [0, 4, 0], opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, delay: index * 0.2 }}
              sx={{ my: 1 }}
            >
              <FaArrowDown size={14} color={systemDesignSteps[index + 1].color} />
            </MotionBox>
          )}
        </Box>
      ))}
    </MotionBox>
  );
}

export default function SystemDesign() {
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [showGate, setShowGate] = useState(false);
  const { unlock, canRead } = useReadingGate();

  const handleOpenChapter = (chapter) => {
    if (!canRead()) {
      setShowGate(true);
      return;
    }
    setSelectedChapter(chapter);
  };

  return (
    <Box
      id="system-design"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="System Design"
          subtitle="62 topics across 12 chapters — a complete curriculum for mastering system design. Click any chapter to read."
        />

        {/* Architecture diagram */}
        <ArchitectureDiagram />

        {/* Stats bar */}
        <MotionBox
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          sx={{ mb: 5 }}
        >
          <GlassCard
            sx={{
              p: 3,
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: { xs: 3, md: 6 },
              background: 'linear-gradient(135deg, rgba(0,201,167,0.04) 0%, rgba(108,99,255,0.04) 100%)',
            }}
          >
            {[
              { value: '12', label: 'Chapters', color: '#00C9A7' },
              { value: '62', label: 'Topics', color: '#6C63FF' },
              { value: '2', label: 'Learning Tracks', color: '#F5A623' },
              { value: '13', label: 'Sections per Topic', color: '#3B82F6' },
            ].map((stat) => (
              <Stack key={stat.label} alignItems="center" spacing={0.5}>
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    color: stat.color,
                    fontSize: { xs: '1.5rem', md: '2rem' },
                  }}
                >
                  {stat.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {stat.label}
                </Typography>
              </Stack>
            ))}
          </GlassCard>
        </MotionBox>

        {/* Chapters grid */}
        <MotionGrid
          container
          spacing={2.5}
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          {systemDesignChapters.map((chapter, index) => (
            <Grid key={chapter.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <ChapterCard
                chapter={chapter}
                index={index}
                onOpen={(ch) => handleOpenChapter(ch)}
              />
            </Grid>
          ))}
        </MotionGrid>

        {/* GitHub link */}
        <MotionBox
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          sx={{ mt: 5, textAlign: 'center' }}
        >
          <Typography variant="body2" color="text.secondary">
            Full curriculum available on{' '}
            <Box
              component="a"
              href="https://github.com/sonu-rathinfotech/system-design-curriculum"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                color: '#00C9A7',
                fontWeight: 600,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                '&:hover': { color: '#6C63FF' },
              }}
            >
              GitHub
            </Box>
          </Typography>
        </MotionBox>
      </Container>

      {/* Book Reader */}
      <BookReader
        chapter={selectedChapter}
        open={!!selectedChapter}
        onClose={() => setSelectedChapter(null)}
      />

      {/* Reading gate dialog */}
      <ReadingGate
        open={showGate}
        onClose={() => setShowGate(false)}
        onUnlock={unlock}
      />
    </Box>
  );
}
