import { Box, Typography, Container, Grid, Chip, Stack, IconButton, Dialog, DialogContent, CircularProgress } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import { FaClock, FaCalendarAlt, FaArrowRight, FaTimes, FaBookOpen } from 'react-icons/fa';
import { blogs } from '../../data/portfolioData';
import { fadeInUp, staggerContainer } from '../../data/animations';
import SectionHeading from '../ui/SectionHeading';
import GlassCard from '../ui/GlassCard';

// Lazy-load blog markdown — each file becomes a separate chunk
const mdLoaders = import.meta.glob('../../data/blogs/*.md', { query: '?raw', import: 'default' });

// Build loader lookup: filename (without extension) → loader function
const blogLoaders = {};
for (const [path, loader] of Object.entries(mdLoaders)) {
  const filename = path.split('/').pop().replace('.md', '');
  blogLoaders[filename] = loader;
}

// Cache loaded content in memory
const blogContentCache = {};

const MotionBox = motion.create(Box);
const MotionGrid = motion.create(Grid);

function useBlogContent(file) {
  const [content, setContent] = useState(blogContentCache[file] || '');
  const [loading, setLoading] = useState(!blogContentCache[file]);

  const load = useCallback(() => {
    if (blogContentCache[file]) {
      setContent(blogContentCache[file]);
      setLoading(false);
      return;
    }
    const loader = blogLoaders[file];
    if (!loader) { setLoading(false); return; }
    setLoading(true);
    loader().then((md) => {
      blogContentCache[file] = md;
      setContent(md);
      setLoading(false);
    });
  }, [file]);

  return { content, loading, load };
}

function FlipCard({ blog, index, onReadMore }) {
  const accentColors = ['#00C9A7', '#6C63FF', '#F5A623', '#3B82F6'];
  const accent = accentColors[index % accentColors.length];
  const [isFlipped, setIsFlipped] = useState(false);
  const { content, loading, load } = useBlogContent(blog.file);

  const handleFlip = () => {
    if (!isFlipped) load(); // lazy-load on first flip
    setIsFlipped(!isFlipped);
  };

  return (
    <MotionBox
      variants={fadeInUp}
      sx={{
        height: { xs: 320, md: 340 },
        perspective: '1200px',
      }}
    >
      <Box
        onClick={handleFlip}
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          cursor: 'pointer',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* ===== FRONT FACE ===== */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <GlassCard
            hover={false}
            sx={{
              p: 3,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderTop: `2px solid ${accent}`,
              transition: 'all 0.3s ease',
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.06)',
                borderColor: accent,
                boxShadow: `0 0 30px ${accent}15`,
              },
              '&:hover .blog-arrow': {
                transform: 'translateX(5px)',
                color: accent,
              },
            }}
          >
            {/* Tags */}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              {blog.tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  sx={{
                    background: `${accent}15`,
                    color: accent,
                    border: `1px solid ${accent}30`,
                    fontSize: '0.7rem',
                    height: 22,
                  }}
                />
              ))}
            </Stack>

            {/* Title */}
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                mb: 2,
                fontSize: { xs: '1rem', md: '1.1rem' },
                lineHeight: 1.4,
              }}
            >
              {blog.title}
            </Typography>

            {/* Excerpt */}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mb: 3,
                flex: 1,
                lineHeight: 1.7,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {blog.excerpt}
            </Typography>

            {/* Meta */}
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={2}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <FaCalendarAlt size={11} color="#94A3B8" />
                  <Typography variant="caption" color="text.secondary">
                    {blog.date}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <FaClock size={11} color="#94A3B8" />
                  <Typography variant="caption" color="text.secondary">
                    {blog.readTime}
                  </Typography>
                </Stack>
              </Stack>
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                className="blog-arrow"
                sx={{
                  transition: 'all 0.3s ease',
                  color: 'text.secondary',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Flip to preview
                </Typography>
                <FaArrowRight size={12} />
              </Stack>
            </Stack>
          </GlassCard>
        </Box>

        {/* ===== BACK FACE ===== */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <GlassCard
            hover={false}
            sx={{
              p: 3,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: `linear-gradient(135deg, ${accent}08 0%, rgba(17,24,39,0.95) 100%)`,
              borderTop: `2px solid ${accent}`,
            }}
          >
            {/* Back header */}
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <FaBookOpen size={16} color={accent} />
                <Typography variant="body2" sx={{ fontWeight: 700, color: accent }}>
                  Preview
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Click to flip back
              </Typography>
            </Stack>

            {/* Preview content from markdown */}
            <Box
              sx={{
                flex: 1,
                overflow: 'hidden',
                position: 'relative',
                '& h1': { display: 'none' },
                '& h2': {
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: '#F1F5F9',
                  mt: 1.5,
                  mb: 0.5,
                },
                '& h3': {
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: accent,
                  mt: 1,
                  mb: 0.5,
                },
                '& p': {
                  fontSize: '0.8rem',
                  color: '#94A3B8',
                  lineHeight: 1.6,
                  mb: 0.5,
                },
                '& ul, & ol': {
                  pl: 2,
                  '& li': {
                    fontSize: '0.78rem',
                    color: '#94A3B8',
                    lineHeight: 1.5,
                  },
                },
                '& pre': {
                  display: 'none',
                },
                '& code': {
                  display: 'none',
                },
                '& table': {
                  display: 'none',
                },
                '& hr': {
                  display: 'none',
                },
                '& blockquote': {
                  display: 'none',
                },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  background: 'linear-gradient(to bottom, transparent, #111827)',
                  pointerEvents: 'none',
                },
              }}
            >
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 3 }}>
                  <CircularProgress size={24} sx={{ color: accent }} />
                </Box>
              ) : (
                <Markdown>{content}</Markdown>
              )}
            </Box>

            {/* Read full article button */}
            <MotionBox
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={(e) => {
                e.stopPropagation();
                onReadMore(blog);
              }}
              sx={{
                mt: 2,
                py: 1.2,
                px: 3,
                borderRadius: 2,
                background: `linear-gradient(135deg, ${accent}, ${accent}CC)`,
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.85rem',
                textAlign: 'center',
                cursor: 'pointer',
                '&:hover': {
                  boxShadow: `0 0 25px ${accent}40`,
                },
              }}
            >
              Read Full Article
            </MotionBox>
          </GlassCard>
        </Box>
      </Box>
    </MotionBox>
  );
}

function BlogReader({ blog, open, onClose, accentColor }) {
  const accent = accentColor || '#00C9A7';
  const { content, loading, load } = useBlogContent(blog?.file);

  useEffect(() => {
    if (open && blog?.file) load();
  }, [open, blog?.file, load]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          background: '#0D1117',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          maxHeight: '90vh',
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        {/* Header */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            p: 3,
            pb: 2,
            background: 'rgba(13, 17, 23, 0.95)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <Box sx={{ flex: 1, mr: 2 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              {blog?.tags?.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  sx={{
                    background: `${accent}15`,
                    color: accent,
                    border: `1px solid ${accent}30`,
                    fontSize: '0.7rem',
                    height: 22,
                  }}
                />
              ))}
            </Stack>
            <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.3 }}>
              {blog?.title}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {blog?.date}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {blog?.readTime}
              </Typography>
            </Stack>
          </Box>
          <IconButton
            onClick={onClose}
            sx={{
              color: 'text.secondary',
              background: 'rgba(255,255,255,0.05)',
              '&:hover': { background: 'rgba(255,255,255,0.1)', color: '#F1F5F9' },
            }}
          >
            <FaTimes size={16} />
          </IconButton>
        </Box>

        {/* Markdown content */}
        <Box
          sx={{
            p: { xs: 3, md: 5 },
            '& h1': {
              display: 'none',
            },
            '& h2': {
              fontSize: '1.4rem',
              fontWeight: 700,
              color: '#F1F5F9',
              mt: 4,
              mb: 2,
              pb: 1,
              borderBottom: `1px solid ${accent}25`,
            },
            '& h3': {
              fontSize: '1.15rem',
              fontWeight: 600,
              color: accent,
              mt: 3,
              mb: 1.5,
            },
            '& p': {
              fontSize: '0.95rem',
              color: '#CBD5E1',
              lineHeight: 1.8,
              mb: 2,
            },
            '& ul, & ol': {
              pl: 3,
              mb: 2,
              '& li': {
                fontSize: '0.93rem',
                color: '#CBD5E1',
                lineHeight: 1.8,
                mb: 0.5,
                '&::marker': {
                  color: accent,
                },
              },
            },
            '& pre': {
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 2,
              p: 2.5,
              mb: 2,
              overflowX: 'auto',
              '& code': {
                fontSize: '0.82rem',
                fontFamily: '"Fira Code", monospace',
                color: '#E2E8F0',
                background: 'transparent',
                p: 0,
                border: 'none',
              },
            },
            '& code': {
              fontSize: '0.85rem',
              fontFamily: '"Fira Code", monospace',
              background: 'rgba(0,201,167,0.1)',
              color: '#00C9A7',
              px: 0.8,
              py: 0.2,
              borderRadius: 1,
              border: '1px solid rgba(0,201,167,0.15)',
            },
            '& table': {
              width: '100%',
              borderCollapse: 'collapse',
              mb: 3,
              '& th': {
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                p: 1.5,
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#F1F5F9',
                textAlign: 'left',
              },
              '& td': {
                border: '1px solid rgba(255,255,255,0.06)',
                p: 1.5,
                fontSize: '0.85rem',
                color: '#94A3B8',
              },
              '& tr:hover td': {
                background: 'rgba(255,255,255,0.02)',
              },
            },
            '& blockquote': {
              borderLeft: `3px solid ${accent}`,
              background: `${accent}08`,
              pl: 2.5,
              py: 1.5,
              pr: 2,
              borderRadius: '0 8px 8px 0',
              mb: 2,
              '& p': {
                color: accent,
                fontStyle: 'italic',
                mb: 0,
              },
            },
            '& hr': {
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              my: 4,
            },
            '& strong': {
              color: '#F1F5F9',
              fontWeight: 700,
            },
            '& em': {
              color: '#94A3B8',
            },
            '& a': {
              color: accent,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            },
            '& img': {
              maxWidth: '100%',
              borderRadius: 2,
            },
            '& input[type="checkbox"]': {
              accentColor: accent,
              mr: 1,
            },
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress sx={{ color: accent }} />
            </Box>
          ) : (
            <Markdown>{content}</Markdown>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

export default function Blog() {
  const accentColors = ['#00C9A7', '#6C63FF', '#F5A623', '#3B82F6'];
  const [selectedBlog, setSelectedBlog] = useState(null);
  const [selectedAccent, setSelectedAccent] = useState('#00C9A7');

  return (
    <Box
      id="blog"
      sx={{
        py: { xs: 10, md: 14 },
        position: 'relative',
      }}
    >
      <Container maxWidth="lg">
        <SectionHeading
          title="Engineering Blog"
          subtitle="Technical deep-dives into systems I've built and concepts I've explored. Click a card to flip and preview."
        />

        <MotionGrid
          container
          spacing={3}
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          {blogs.map((blog, index) => (
            <Grid key={blog.file} size={{ xs: 12, sm: 6 }}>
              <FlipCard
                blog={blog}
                index={index}
                onReadMore={(b) => {
                  setSelectedBlog(b);
                  setSelectedAccent(accentColors[index % accentColors.length]);
                }}
              />
            </Grid>
          ))}
        </MotionGrid>
      </Container>

      {/* Full article reader dialog */}
      <BlogReader
        blog={selectedBlog}
        open={!!selectedBlog}
        onClose={() => setSelectedBlog(null)}
        accentColor={selectedAccent}
      />
    </Box>
  );
}
