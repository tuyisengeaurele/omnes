import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts. Wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Refresh tokens are authenticated by cookie — use a lenient limiter
// separate from the strict brute-force protection on /login
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Too many refresh attempts. Please log in again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many exports. Wait a minute before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const reportDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many report requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
