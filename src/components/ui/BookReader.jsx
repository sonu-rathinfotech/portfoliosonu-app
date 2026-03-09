import { useState, useEffect, useRef, forwardRef, useCallback } from 'react';
import {
  Box, Typography, IconButton, Stack, CircularProgress,
  Dialog, DialogContent, Chip, useMediaQuery, useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import HTMLFlipBook from 'react-pageflip';
import Markdown from 'react-markdown';
import {
  FaTimes, FaChevronLeft, FaChevronRight,
  FaBookOpen, FaExpand, FaCompress, FaGithub,
} from 'react-icons/fa';
import ReadingGate, { useReadingGate } from './ReadingGate';

// Lazy-import all system design .md files (loaded on demand, not bundled upfront)
const sdModules = import.meta.glob('../../data/system-design/*.md', { query: '?raw', import: 'default' });

const MotionBox = motion.create(Box);

// Each page of the flip book
const Page = forwardRef(({ children, pageNumber, totalPages }, ref) => {
  return (
    <div
      ref={ref}
      style={{
        background: '#0D1117',
        padding: '30px 30px 45px 30px',
        overflow: 'hidden',
        position: 'relative',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Page content */}
      <div style={{
        height: '100%',
        overflow: 'hidden',
        fontSize: '15px',
        lineHeight: '1.75',
        color: '#CBD5E1',
      }}>
        {children}
      </div>

      {/* Page number */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: '12px',
        color: '#475569',
      }}>
        {pageNumber} / {totalPages}
      </div>

      {/* Page edge shadow */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 3,
        height: '100%',
        background: 'linear-gradient(to left, rgba(0,0,0,0.3), transparent)',
      }} />
    </div>
  );
});

Page.displayName = 'Page';

// Split markdown into pages based on h2/h3 headings
function splitIntoPages(markdown) {
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const pages = [];
  let currentPage = [];
  let lineCount = 0;
  const MAX_LINES = 45;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{1,3}\s/.test(line);
    const isCodeBlock = line.trim().startsWith('```');

    // Start new page on major headings if current page has content
    if (isHeading && currentPage.length > 8) {
      pages.push(currentPage.join('\n'));
      currentPage = [];
      lineCount = 0;
    }

    currentPage.push(line);
    lineCount++;

    // Also split on line count (approximate page length)
    if (lineCount >= MAX_LINES && !isCodeBlock) {
      // Try to break at a blank line or heading
      const nextLine = lines[i + 1] || '';
      if (nextLine.trim() === '' || /^#{1,3}\s/.test(nextLine)) {
        pages.push(currentPage.join('\n'));
        currentPage = [];
        lineCount = 0;
      }
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage.join('\n'));
  }

  return pages;
}

// Markdown styles for book pages
const markdownStyles = {
  '& h1': {
    fontSize: '1.6rem',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #00C9A7, #6C63FF)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    mb: 2,
    mt: 1,
    lineHeight: 1.3,
  },
  '& h2': {
    fontSize: '1.3rem',
    fontWeight: 700,
    color: '#F1F5F9',
    mt: 2.5,
    mb: 1.5,
    pb: 0.8,
    borderBottom: '1px solid rgba(0,201,167,0.2)',
  },
  '& h3': {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#00C9A7',
    mt: 2,
    mb: 1,
  },
  '& h4': {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#6C63FF',
    mt: 1.5,
    mb: 0.8,
  },
  '& p': {
    fontSize: '0.95rem',
    color: '#CBD5E1',
    lineHeight: 1.8,
    mb: 1.2,
  },
  '& ul, & ol': {
    pl: 2.5,
    mb: 1.5,
    '& li': {
      fontSize: '0.93rem',
      color: '#CBD5E1',
      lineHeight: 1.75,
      mb: 0.4,
      '&::marker': {
        color: '#00C9A7',
      },
    },
  },
  '& pre': {
    background: 'rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '6px',
    p: 2,
    mb: 1.5,
    overflowX: 'auto',
    fontSize: '0.85rem',
    '& code': {
      fontFamily: '"Fira Code", monospace',
      color: '#E2E8F0',
      background: 'transparent',
      p: 0,
      border: 'none',
      fontSize: '0.85rem',
    },
  },
  '& code': {
    fontSize: '0.88rem',
    fontFamily: '"Fira Code", monospace',
    background: 'rgba(0,201,167,0.1)',
    color: '#00C9A7',
    px: 0.6,
    py: 0.15,
    borderRadius: '4px',
    border: '1px solid rgba(0,201,167,0.12)',
  },
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    mb: 2,
    fontSize: '0.88rem',
    '& th': {
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      p: 1.2,
      fontWeight: 600,
      color: '#F1F5F9',
      textAlign: 'left',
    },
    '& td': {
      border: '1px solid rgba(255,255,255,0.05)',
      p: 1.2,
      color: '#94A3B8',
    },
  },
  '& blockquote': {
    borderLeft: '3px solid #6C63FF',
    background: 'rgba(108,99,255,0.06)',
    pl: 2,
    py: 1,
    pr: 1.5,
    borderRadius: '0 6px 6px 0',
    mb: 1.5,
    '& p': {
      color: '#A5B4FC',
      fontStyle: 'italic',
      mb: 0,
      fontSize: '0.93rem',
    },
  },
  '& strong': {
    color: '#F1F5F9',
    fontWeight: 700,
  },
  '& hr': {
    border: 'none',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    my: 2,
  },
  '& img': {
    maxWidth: '100%',
    borderRadius: '6px',
  },
};

export default function BookReader({ chapter, open, onClose }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const flipBookRef = useRef(null);
  const dialogRef = useRef(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { recordPage, unlock, canRead } = useReadingGate();

  // Lazy-load chapter content from local bundled files
  useEffect(() => {
    if (!open || !chapter) return;

    setLoading(true);
    setError(null);
    setCurrentPage(0);

    // Find the matching glob key for this chapter file
    const matchKey = Object.keys(sdModules).find((key) => key.endsWith(`/${chapter.file}`));
    if (matchKey) {
      sdModules[matchKey]()
        .then((md) => {
          setContent(md);
          setLoading(false);
        })
        .catch(() => {
          setError('Failed to load chapter');
          setLoading(false);
        });
    } else {
      setError('Chapter content not found');
      setLoading(false);
    }
  }, [open, chapter]);

  const pages = splitIntoPages(content);
  const totalPages = pages.length;

  const handleFlip = useCallback((e) => {
    setCurrentPage(e.data);
    // Each page flip forward counts as a page read
    if (e.data > currentPage) {
      if (!canRead()) {
        setShowGate(true);
        // Flip back to previous page
        setTimeout(() => flipBookRef.current?.pageFlip()?.flipPrev(), 100);
        return;
      }
      recordPage();
    }
  }, [currentPage, canRead, recordPage]);

  const goNext = () => {
    flipBookRef.current?.pageFlip()?.flipNext();
  };

  const goPrev = () => {
    flipBookRef.current?.pageFlip()?.flipPrev();
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      dialogRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const bookWidth = isMobile ? 380 : 620;
  const bookHeight = isMobile ? 520 : 750;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      fullScreen
      PaperProps={{
        ref: dialogRef,
        sx: {
          background: '#080B12',
          overflow: 'hidden',
        },
      }}
    >
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Top bar */}
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            py: 1.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(13, 17, 23, 0.9)',
            backdropFilter: 'blur(10px)',
            flexShrink: 0,
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: '1.3rem', flexShrink: 0 }}>{chapter?.icon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: '0.85rem', md: '1rem' },
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Chapter {chapter?.id}: {chapter?.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {chapter?.topics} topics · {totalPages} pages
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.5}>
            <IconButton
              component="a"
              href={`https://github.com/sonu-rathinfotech/system-design-curriculum/blob/master/${chapter?.file}`}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              aria-label="View on GitHub"
              sx={{ color: 'text.secondary', '&:hover': { color: '#F1F5F9' } }}
            >
              <FaGithub size={16} />
            </IconButton>
            {!isMobile && (
              <IconButton
                onClick={toggleFullscreen}
                size="small"
                aria-label="Toggle fullscreen"
                sx={{ color: 'text.secondary', '&:hover': { color: '#F1F5F9' } }}
              >
                {isFullscreen ? <FaCompress size={14} /> : <FaExpand size={14} />}
              </IconButton>
            )}
            <IconButton
              onClick={onClose}
              size="small"
              aria-label="Close reader"
              sx={{
                color: 'text.secondary',
                '&:hover': { color: '#F1F5F9', background: 'rgba(255,255,255,0.08)' },
              }}
            >
              <FaTimes size={16} />
            </IconButton>
          </Stack>
        </Box>

        {/* Book area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            background: 'radial-gradient(ellipse at center, #111827 0%, #080B12 70%)',
          }}
        >
          {loading && (
            <Stack alignItems="center" spacing={2}>
              <CircularProgress size={40} sx={{ color: chapter?.color || '#00C9A7' }} />
              <Typography variant="body2" color="text.secondary">
                Loading chapter...
              </Typography>
            </Stack>
          )}

          {error && (
            <Stack alignItems="center" spacing={2}>
              <Typography variant="h6" color="error">
                Failed to load
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {error}
              </Typography>
            </Stack>
          )}

          {!loading && !error && pages.length > 0 && (
            <>
              {/* Previous button */}
              <MotionBox
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={goPrev}
                sx={{
                  position: 'absolute',
                  left: { xs: 8, md: 20 },
                  zIndex: 10,
                  width: { xs: 36, md: 44 },
                  height: { xs: 36, md: 44 },
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  color: '#94A3B8',
                  opacity: currentPage === 0 ? 0.3 : 1,
                  '&:hover': {
                    background: 'rgba(255,255,255,0.1)',
                    color: '#F1F5F9',
                  },
                }}
              >
                <FaChevronLeft size={16} />
              </MotionBox>

              {/* Flip Book */}
              <Box
                sx={{
                  '& .stf__parent': {
                    margin: '0 auto',
                  },
                  '& .--shadow': {
                    boxShadow: '0 0 40px rgba(0,0,0,0.5) !important',
                  },
                }}
              >
                <HTMLFlipBook
                  ref={flipBookRef}
                  width={bookWidth}
                  height={bookHeight}
                  size="stretch"
                  minWidth={340}
                  maxWidth={750}
                  minHeight={450}
                  maxHeight={900}
                  showCover={true}
                  mobileScrollSupport={true}
                  onFlip={handleFlip}
                  flippingTime={600}
                  usePortrait={isMobile}
                  maxShadowOpacity={0.5}
                  drawShadow={true}
                  style={{
                    boxShadow: '0 10px 60px rgba(0,0,0,0.6)',
                    borderRadius: '4px',
                  }}
                >
                  {/* Cover page */}
                  <Page pageNumber={1} totalPages={totalPages + 1}>
                    <Box
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        gap: 3,
                      }}
                    >
                      <Box sx={{ fontSize: '5rem' }}>{chapter?.icon}</Box>
                      <Typography
                        variant="h3"
                        sx={{
                          fontWeight: 800,
                          background: `linear-gradient(135deg, ${chapter?.color || '#00C9A7'}, #6C63FF)`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          lineHeight: 1.3,
                          fontSize: { xs: '1.5rem', md: '2rem' },
                        }}
                      >
                        {chapter?.title}
                      </Typography>
                      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 300 }}>
                        {chapter?.subtitle}
                      </Typography>
                      <Chip
                        label={`${chapter?.topics} Topics`}
                        size="small"
                        sx={{
                          background: `${chapter?.color}20`,
                          color: chapter?.color,
                          border: `1px solid ${chapter?.color}40`,
                          fontWeight: 600,
                        }}
                      />
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                        <FaBookOpen size={14} color="#94A3B8" />
                        <Typography variant="caption" color="text.secondary">
                          System Design Curriculum
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto' }}>
                        Use arrow keys or swipe to flip pages
                      </Typography>
                    </Box>
                  </Page>

                  {/* Content pages */}
                  {pages.map((pageContent, idx) => (
                    <Page key={idx} pageNumber={idx + 2} totalPages={totalPages + 1}>
                      <Box sx={markdownStyles}>
                        <Markdown>{pageContent}</Markdown>
                      </Box>
                    </Page>
                  ))}
                </HTMLFlipBook>
              </Box>

              {/* Next button */}
              <MotionBox
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={goNext}
                sx={{
                  position: 'absolute',
                  right: { xs: 8, md: 20 },
                  zIndex: 10,
                  width: { xs: 36, md: 44 },
                  height: { xs: 36, md: 44 },
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  color: '#94A3B8',
                  opacity: currentPage >= totalPages ? 0.3 : 1,
                  '&:hover': {
                    background: 'rgba(255,255,255,0.1)',
                    color: '#F1F5F9',
                  },
                }}
              >
                <FaChevronRight size={16} />
              </MotionBox>
            </>
          )}
        </Box>

        {/* Bottom progress bar */}
        {!loading && totalPages > 0 && (
          <Box
            sx={{
              px: 3,
              py: 1.5,
              borderTop: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(13, 17, 23, 0.9)',
              flexShrink: 0,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={2}>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Page {currentPage + 1} of {totalPages + 1}
              </Typography>
              <Box
                sx={{
                  flex: 1,
                  height: 3,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    width: `${((currentPage + 1) / (totalPages + 1)) * 100}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${chapter?.color || '#00C9A7'}, #6C63FF)`,
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {Math.round(((currentPage + 1) / (totalPages + 1)) * 100)}%
              </Typography>
            </Stack>
          </Box>
        )}
      </DialogContent>

      {/* Reading gate */}
      <ReadingGate
        open={showGate}
        onClose={() => setShowGate(false)}
        onUnlock={unlock}
      />
    </Dialog>
  );
}
