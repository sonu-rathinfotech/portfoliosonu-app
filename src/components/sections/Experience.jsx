import { Box, Typography, Container, Chip, Stack } from '@mui/material';
import { motion } from 'framer-motion';
import { FaCalendarAlt, FaMapMarkerAlt, FaExclamationTriangle } from 'react-icons/fa';
import { experiences } from '../../data/portfolioData';
import { fadeInUp, slideInTimeline } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

const MotionBox = motion.create(Box);

/* ── Floating domain illustration ── */
function DomainIllustration({ type }) {
  const isBanking = type === 'banking';

  return (
    <MotionBox
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      sx={{
        width: 80,
        height: 80,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isBanking
          ? 'linear-gradient(135deg, rgba(0,201,167,0.15), rgba(16,185,129,0.08))'
          : 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(59,130,246,0.08))',
        border: `2px solid ${isBanking ? 'rgba(0,201,167,0.25)' : 'rgba(108,99,255,0.25)'}`,
        boxShadow: isBanking
          ? '0 0 40px rgba(0,201,167,0.15)'
          : '0 0 40px rgba(108,99,255,0.15)',
        fontSize: '2.2rem',
        mb: 2,
      }}
    >
      {isBanking ? '🏦' : '🛒'}
    </MotionBox>
  );
}

/* ── Visual panel on the opposite side of the timeline ── */
function ExperienceVisual({ experience }) {
  return (
    <MotionBox
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.2 }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        width: '100%',
      }}
    >
      {/* Domain illustration */}
      <DomainIllustration type={experience.type} />

      {/* Highlight metrics 2x2 grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, width: '100%' }}>
        {experience.highlights?.map((item, i) => {
          const Icon = item.icon;
          return (
            <MotionBox
              key={i}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 + i * 0.1 }}
              whileHover={{ y: -3, scale: 1.03 }}
            >
              <GlassCard
                sx={{
                  p: 2,
                  textAlign: 'center',
                  borderTop: `2px solid ${item.color}`,
                  background: `linear-gradient(135deg, ${item.color}08 0%, transparent 100%)`,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: `0 0 25px ${item.color}20`,
                    borderColor: item.color,
                  },
                }}
              >
                <Icon size={18} color={item.color} style={{ marginBottom: 6 }} />
                <Typography
                  sx={{ fontWeight: 800, fontSize: '1.2rem', color: item.color, lineHeight: 1, mb: 0.5 }}
                >
                  {item.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                  {item.label}
                </Typography>
              </GlassCard>
            </MotionBox>
          );
        })}
      </Box>

      {/* Tech stack icons row */}
      <GlassCard sx={{ p: 2, width: '100%', background: 'rgba(255,255,255,0.02)' }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            fontWeight: 600, mb: 1.5, display: 'block', textAlign: 'center',
            letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.65rem',
          }}
        >
          Tech Stack
        </Typography>
        <Stack direction="row" justifyContent="center" spacing={2.5}>
          {experience.techIcons?.map((tech, i) => {
            const Icon = tech.icon;
            return (
              <MotionBox
                key={i}
                whileHover={{ y: -4, scale: 1.2 }}
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}
              >
                <Box
                  sx={{
                    width: 40, height: 40, borderRadius: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `${tech.color}12`,
                    border: `1px solid ${tech.color}25`,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      background: `${tech.color}20`,
                      boxShadow: `0 0 15px ${tech.color}30`,
                    },
                  }}
                >
                  <Icon size={20} color={tech.color} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                  {tech.name}
                </Typography>
              </MotionBox>
            );
          })}
        </Stack>
      </GlassCard>
    </MotionBox>
  );
}

/* ── Experience card content ── */
function ExperienceCard({ experience }) {
  return (
    <GlassCard
      glow
      sx={{
        p: { xs: 3, md: 4 },
        width: '100%',
        background: experience.type === 'banking'
          ? 'linear-gradient(135deg, rgba(0,201,167,0.04) 0%, rgba(16,185,129,0.02) 100%)'
          : 'linear-gradient(135deg, rgba(108,99,255,0.04) 0%, rgba(59,130,246,0.02) 100%)',
      }}
    >
      <Chip
        label={experience.type === 'banking' ? '🏦 Banking Domain' : '🛒 E-Commerce'}
        size="small"
        sx={{
          mb: 2,
          background: experience.type === 'banking' ? 'rgba(0,201,167,0.15)' : 'rgba(108,99,255,0.15)',
          color: experience.type === 'banking' ? '#00C9A7' : '#6C63FF',
          fontWeight: 600,
          border: `1px solid ${experience.type === 'banking' ? 'rgba(0,201,167,0.3)' : 'rgba(108,99,255,0.3)'}`,
        }}
      />

      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {experience.role}
      </Typography>

      <Typography
        variant="h6"
        sx={{
          color: experience.type === 'banking' ? '#00C9A7' : '#6C63FF',
          fontWeight: 600, fontSize: '1rem', mb: 1.5,
        }}
      >
        {experience.company}
      </Typography>

      <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <FaCalendarAlt size={12} color="#94A3B8" />
          <Typography variant="body2" color="text.secondary">{experience.duration}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <FaMapMarkerAlt size={12} color="#94A3B8" />
          <Typography variant="body2" color="text.secondary">{experience.location}</Typography>
        </Stack>
      </Stack>

      <Box component="ul" sx={{ pl: 2, mb: 2 }}>
        {experience.description.map((item, i) => (
          <Box
            component="li"
            key={i}
            sx={{
              color: 'text.secondary', mb: 1, fontSize: '0.9rem', lineHeight: 1.7,
              '&::marker': { color: experience.type === 'banking' ? '#00C9A7' : '#6C63FF' },
            }}
          >
            {item}
          </Box>
        ))}
      </Box>

      {experience.challengesSolved && (
        <Box
          sx={{
            mt: 2, p: 2, borderRadius: 2,
            background: 'rgba(245,166,35,0.05)',
            border: '1px solid rgba(245,166,35,0.15)',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <FaExclamationTriangle size={14} color="#F5A623" />
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#F5A623' }}>
              Engineering Challenges Solved
            </Typography>
          </Stack>
          {experience.challengesSolved.map((challenge, i) => (
            <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem', mb: 0.5, pl: 2 }}>
              • {challenge}
            </Typography>
          ))}
        </Box>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
        {experience.technologies.map((tech) => (
          <Chip
            key={tech}
            label={tech}
            size="small"
            sx={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'text.secondary', fontSize: '0.75rem',
            }}
          />
        ))}
      </Stack>
    </GlassCard>
  );
}

/* ── Timeline item with card + visual panel ── */
function TimelineItem({ experience, index }) {
  const isLeft = index % 2 === 0;

  return (
    <Box sx={{ display: 'flex', width: '100%', mb: 6, position: 'relative' }}>
      {/* Timeline dot */}
      <MotionBox
        whileHover={{ scale: 1.3 }}
        sx={{
          position: 'absolute',
          left: { xs: 0, md: '50%' },
          transform: { xs: 'none', md: 'translateX(-50%)' },
          width: 20, height: 20, borderRadius: '50%',
          background: experience.type === 'banking'
            ? 'linear-gradient(135deg, #00C9A7, #10B981)'
            : 'linear-gradient(135deg, #6C63FF, #3B82F6)',
          border: '3px solid #0A0E17',
          zIndex: 2,
          boxShadow: experience.type === 'banking'
            ? '0 0 20px rgba(0,201,167,0.4)'
            : '0 0 20px rgba(108,99,255,0.4)',
          top: 30,
        }}
      />

      {/* Desktop: two-column layout with card + visual */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, width: '100%' }}>
        {/* Left column */}
        <Box sx={{ width: '47%', pr: 4 }}>
          {isLeft ? (
            <MotionBox
              custom={true}
              variants={slideInTimeline}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-50px' }}
            >
              <ExperienceCard experience={experience} />
            </MotionBox>
          ) : (
            <ExperienceVisual experience={experience} />
          )}
        </Box>

        {/* Center spacer for timeline */}
        <Box sx={{ width: '6%' }} />

        {/* Right column */}
        <Box sx={{ width: '47%', pl: 4 }}>
          {isLeft ? (
            <ExperienceVisual experience={experience} />
          ) : (
            <MotionBox
              custom={false}
              variants={slideInTimeline}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-50px' }}
            >
              <ExperienceCard experience={experience} />
            </MotionBox>
          )}
        </Box>
      </Box>

      {/* Mobile: single column with highlights below */}
      <Box sx={{ display: { xs: 'block', md: 'none' }, pl: 5, width: '100%' }}>
        <MotionBox
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          <ExperienceCard experience={experience} />

          {experience.highlights && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 2 }}>
              {experience.highlights.map((item, i) => {
                const Icon = item.icon;
                return (
                  <GlassCard
                    key={i}
                    sx={{
                      p: 1.5, textAlign: 'center',
                      borderTop: `2px solid ${item.color}`,
                    }}
                  >
                    <Icon size={14} color={item.color} style={{ marginBottom: 4 }} />
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: item.color, lineHeight: 1, mb: 0.3 }}>
                      {item.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                      {item.label}
                    </Typography>
                  </GlassCard>
                );
              })}
            </Box>
          )}
        </MotionBox>
      </Box>
    </Box>
  );
}

export default function Experience() {
  return (
    <Box
      id="experience"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="Work Experience"
          subtitle="4 years of building production systems across banking and e-commerce domains"
        />

        <Box sx={{ position: 'relative' }}>
          {/* Timeline center line */}
          <Box
            sx={{
              position: 'absolute',
              left: { xs: 9, md: '50%' },
              transform: { xs: 'none', md: 'translateX(-50%)' },
              top: 0, bottom: 0, width: 2,
              background: 'linear-gradient(to bottom, #00C9A7, #6C63FF, rgba(108,99,255,0.1))',
            }}
          />

          {experiences.map((exp, index) => (
            <TimelineItem key={exp.id} experience={exp} index={index} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
