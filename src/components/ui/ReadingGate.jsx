import { useState, useCallback } from 'react';
import {
  Dialog, DialogContent, Box, Typography, TextField,
  Stack, IconButton,
} from '@mui/material';
import { motion } from 'framer-motion';
import { FaLock, FaTimes, FaEnvelope } from 'react-icons/fa';
import GlassCard from './GlassCard';

const MotionBox = motion.create(Box);

const COUNT_KEY = 'portfolio_page_count';
const UNLOCK_KEY = 'portfolio_unlocked';
const MAX_FREE_PAGES = 10;
const PASSWORD = 'sonu2025';

/* ── Hook: tracks total pages read and gate state ── */
export function useReadingGate() {
  const isUnlocked = () => localStorage.getItem(UNLOCK_KEY) === 'true';

  const getPageCount = () => {
    try { return parseInt(localStorage.getItem(COUNT_KEY) || '0', 10); }
    catch { return 0; }
  };

  // Check if user can read more pages
  const canRead = useCallback(() => {
    if (isUnlocked()) return true;
    return getPageCount() < MAX_FREE_PAGES;
  }, []);

  // Increment page counter (call each time a new page is viewed)
  const recordPage = useCallback(() => {
    if (isUnlocked()) return true;
    const count = getPageCount();
    if (count >= MAX_FREE_PAGES) return false;
    localStorage.setItem(COUNT_KEY, String(count + 1));
    return true;
  }, []);

  const unlock = useCallback((pwd) => {
    if (pwd === PASSWORD) {
      localStorage.setItem(UNLOCK_KEY, 'true');
      return true;
    }
    return false;
  }, []);

  return { canRead, recordPage, unlock, isUnlocked, getPageCount, maxPages: MAX_FREE_PAGES };
}

/* ── Gate dialog ── */
export default function ReadingGate({ open, onClose, onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onUnlock(password)) {
      setPassword('');
      setError(false);
      onClose();
    } else {
      setError(true);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          background: 'transparent',
          boxShadow: 'none',
          overflow: 'visible',
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <GlassCard
          glow
          sx={{
            p: 4,
            textAlign: 'center',
            background: 'rgba(10, 14, 23, 0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            position: 'relative',
          }}
        >
          {/* Close button */}
          <IconButton
            onClick={onClose}
            sx={{
              position: 'absolute', top: 12, right: 12,
              color: 'text.secondary',
              '&:hover': { color: '#F1F5F9' },
            }}
          >
            <FaTimes size={14} />
          </IconButton>

          {/* Lock icon */}
          <MotionBox
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            sx={{
              width: 70, height: 70, borderRadius: '50%', mx: 'auto', mb: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(245,166,35,0.15), rgba(239,68,68,0.1))',
              border: '2px solid rgba(245,166,35,0.3)',
              boxShadow: '0 0 40px rgba(245,166,35,0.15)',
            }}
          >
            <FaLock size={28} color="#F5A623" />
          </MotionBox>

          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
            Reading Limit Reached
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.7 }}>
            You've read 10 pages for free. Enter the access password to unlock all content.
          </Typography>

          {/* Password form */}
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              error={error}
              helperText={error ? 'Incorrect password' : ''}
              sx={{
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 2,
                  '& fieldset': { borderColor: error ? '#EF4444' : 'rgba(255,255,255,0.1)' },
                  '&:hover fieldset': { borderColor: error ? '#EF4444' : 'rgba(255,255,255,0.2)' },
                  '&.Mui-focused fieldset': { borderColor: error ? '#EF4444' : '#00C9A7' },
                },
                '& input': { color: '#F1F5F9', textAlign: 'center', fontSize: '1rem' },
              }}
            />

            <MotionBox
              component="button"
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              sx={{
                width: '100%', py: 1.5, border: 'none', borderRadius: 2,
                background: 'linear-gradient(135deg, #00C9A7, #6C63FF)',
                color: '#fff', fontWeight: 700, fontSize: '0.95rem',
                cursor: 'pointer',
                '&:hover': { boxShadow: '0 0 30px rgba(0,201,167,0.3)' },
              }}
            >
              Unlock All Content
            </MotionBox>
          </Box>

          {/* Divider */}
          <Stack direction="row" alignItems="center" spacing={2} sx={{ my: 3 }}>
            <Box sx={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            <Typography variant="caption" color="text.secondary">or</Typography>
            <Box sx={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </Stack>

          {/* Contact option */}
          <MotionBox
            component="a"
            href="mailto:prajapatisonu50@gmail.com?subject=Portfolio Access Request"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
              width: '100%', py: 1.5, borderRadius: 2,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#94A3B8', fontWeight: 600, fontSize: '0.9rem',
              textDecoration: 'none', cursor: 'pointer',
              '&:hover': {
                background: 'rgba(255,255,255,0.08)',
                color: '#F1F5F9',
                borderColor: 'rgba(255,255,255,0.2)',
              },
            }}
          >
            <FaEnvelope size={14} />
            Contact me for access
          </MotionBox>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            prajapatisonu50@gmail.com
          </Typography>
        </GlassCard>
      </DialogContent>
    </Dialog>
  );
}
