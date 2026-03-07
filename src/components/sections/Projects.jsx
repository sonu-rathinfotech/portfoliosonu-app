import { Box, Typography, Container, Grid, Chip, Stack, IconButton } from '@mui/material';
import { motion } from 'framer-motion';
import { FaGithub, FaExternalLinkAlt } from 'react-icons/fa';
import { projects } from '../../data/portfolioData';
import { fadeInUp, staggerContainer } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

const MotionBox = motion.create(Box);
const MotionGrid = motion.create(Grid);

function ProjectCard({ project, index }) {
  return (
    <MotionBox
      variants={fadeInUp}
      whileHover={{ y: -8 }}
      sx={{ height: '100%' }}
    >
      <GlassCard
        hover
        glow
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          '&:hover .project-overlay': {
            opacity: 1,
          },
          '&:hover .project-icon': {
            transform: 'scale(1.2)',
          },
        }}
      >
        {/* Project header with icon */}
        <Box
          sx={{
            p: 3,
            pb: 2,
            position: 'relative',
            background: `linear-gradient(135deg, ${
              ['rgba(0,201,167,0.08)', 'rgba(108,99,255,0.08)', 'rgba(245,166,35,0.08)', 'rgba(59,130,246,0.08)'][index % 4]
            } 0%, transparent 100%)`,
          }}
        >
          <Box
            className="project-icon"
            sx={{
              fontSize: '2.5rem',
              mb: 2,
              transition: 'transform 0.3s ease',
            }}
          >
            {project.icon}
          </Box>

          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
              {project.title}
            </Typography>
            <Stack direction="row" spacing={0.5}>
              {project.github && (
                <IconButton
                  component="a"
                  href={project.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  aria-label={`View ${project.title} on GitHub`}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: '#00C9A7' },
                  }}
                >
                  <FaGithub size={18} />
                </IconButton>
              )}
              {project.demo && project.demo !== '#' && (
                <IconButton
                  component="a"
                  href={project.demo}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  aria-label={`View ${project.title} live demo`}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: '#6C63FF' },
                  }}
                >
                  <FaExternalLinkAlt size={16} />
                </IconButton>
              )}
            </Stack>
          </Stack>
        </Box>

        {/* Content */}
        <Box sx={{ p: 3, pt: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 3,
              flex: 1,
              lineHeight: 1.7,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {project.description}
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {project.technologies.map((tech) => (
              <Chip
                key={tech}
                label={tech}
                size="small"
                sx={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  height: 24,
                }}
              />
            ))}
          </Stack>
        </Box>
      </GlassCard>
    </MotionBox>
  );
}

export default function Projects() {
  return (
    <Box
      id="projects"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="Featured Projects"
          subtitle="Production-grade applications showcasing full-stack engineering capabilities"
        />

        <MotionGrid
          container
          spacing={3}
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          {projects.map((project, index) => (
            <Grid key={project.id} size={{ xs: 12, sm: 6 }}>
              <ProjectCard project={project} index={index} />
            </Grid>
          ))}
        </MotionGrid>
      </Container>
    </Box>
  );
}
