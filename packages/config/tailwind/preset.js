/**
 * Shared Tailwind preset for every Omnes web surface.
 *
 * Apps set their own `content` globs and add nothing else unless they have a
 * genuine reason. The point of a preset is that the customer, merchant and admin
 * apps cannot drift into three different-looking products.
 *
 * Colour values come from ./tokens.js. Read the contrast note there before
 * using `accent` as anything other than a surface.
 */

import {
  aureolin,
  bistre,
  neutral,
  semantic,
  ink,
  radius,
  elevation,
  typography,
  touchTarget,
} from './tokens.js';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        aureolin,
        bistre,
        neutral,
        accent: aureolin,
        ink: {
          DEFAULT: ink.primary,
          primary: ink.primary,
          secondary: ink.secondary,
          muted: ink.muted,
          inverse: ink.inverse,
          'on-accent': ink.onAccent,
        },
        success: { DEFAULT: semantic.success.base, ...semantic.success },
        warning: { DEFAULT: semantic.warning.base, ...semantic.warning },
        danger: { DEFAULT: semantic.danger.base, ...semantic.danger },
        info: { DEFAULT: semantic.info.base, ...semantic.info },

        // shadcn/ui consumes these as CSS variables so a component library drop-in
        // picks up Omnes colours without a per-component override.
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
      },

      borderRadius: {
        ...radius,
        // shadcn/ui derives its scale from a single --radius variable.
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 4px)',
      },

      boxShadow: elevation,
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,

      spacing: {
        touch: touchTarget,
      },

      minHeight: { touch: touchTarget },
      minWidth: { touch: touchTarget },

      // Deliberately no `backgroundImage` gradients. Flat means flat; if a
      // gradient is ever needed it should be an argued exception, not reachable
      // by typing `bg-gradient-to-r` out of habit.

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Order tracking: a slow pulse on the active step. Respects
        // prefers-reduced-motion via the utility below.
        'status-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'status-pulse': 'status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [
    /**
     * Motion is opt-out at the system level, not per-component. A driver
     * tracking screen that animates through a migraine is a real complaint.
     */
    function reducedMotion({ addBase }) {
      addBase({
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      });
    },
  ],
};
