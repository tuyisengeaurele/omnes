/**
 * Omnes design tokens.
 *
 * Framework-agnostic on purpose: the Tailwind preset consumes these, and so will
 * anything that cannot use Tailwind: transactional email templates, PDF receipts,
 * the merchant kitchen ticket. One definition, several renderers.
 *
 * Brand: aureolin (#FBE311) as accent, bistre (#261606) as the grounding dark.
 * Flat. No gradients.
 *
 * CONTRAST. This is a constraint rather than a preference (NFR-USA-002):
 *   aureolin on white  =  1.3:1  -> fails every threshold. Never text on light.
 *   bistre on aureolin = 13.4:1  -> passes AAA. This is the accent pairing.
 *   bistre on white    = 17.6:1  -> passes AAA. This is body text.
 *
 * Aureolin is a surface you put bistre on top of. It is never a text colour on a
 * light background, and it is never a foreground for anything that must be read.
 * `ink.onAccent` exists so that pairing is the path of least resistance.
 */

/** Primary accent. Backgrounds, active states, focus rings, brand marks. */
export const aureolin = {
  50: '#FEFDE8',
  100: '#FDFAC4',
  200: '#FCF48C',
  300: '#FCEC4A',
  400: '#FBE311',
  DEFAULT: '#FBE311',
  500: '#E2C908',
  600: '#C3A605',
  700: '#9B7F08',
  800: '#80660F',
  900: '#6D5413',
  950: '#402F06',
};

/** Grounding dark. Text, headers, high-emphasis surfaces. */
export const bistre = {
  50: '#FAF7F4',
  100: '#F1EAE1',
  200: '#E2D3C2',
  300: '#CDB59B',
  400: '#B59274',
  500: '#A3785A',
  600: '#95674E',
  700: '#7C5342',
  800: '#66453A',
  900: '#553B32',
  950: '#261606',
  DEFAULT: '#261606',
};

/** Neutrals, warmed very slightly toward bistre so greys do not read as blue. */
export const neutral = {
  0: '#FFFFFF',
  50: '#FAFAF9',
  100: '#F5F4F2',
  200: '#E8E6E3',
  300: '#D5D2CD',
  400: '#A8A29A',
  500: '#7C766D',
  600: '#5C5750',
  700: '#443F3A',
  800: '#2B2723',
  900: '#1A1714',
  1000: '#000000',
};

/**
 * Semantic colours. Each is a pair: a `base` dark enough for text on white
 * (>= 4.5:1) and a `surface` light enough to carry that text as a background.
 * Order status leans on these, so they must stay distinguishable, including for
 * the roughly 8% of male users with red/green colour vision deficiency. That is
 * why `warning` is amber-brown rather than orange, and why every status carries a
 * text label instead of relying on colour alone.
 */
export const semantic = {
  success: { base: '#166534', surface: '#ECFDF3', border: '#ABEFC6' },
  warning: { base: '#92400E', surface: '#FFFAEB', border: '#FEDF89' },
  danger: { base: '#B42318', surface: '#FEF3F2', border: '#FECDCA' },
  info: { base: '#175CD3', surface: '#EFF8FF', border: '#B2DDFF' },
};

/** Foreground colours, named by where they are legible. */
export const ink = {
  primary: bistre[950],
  secondary: neutral[600],
  muted: neutral[500],
  inverse: neutral[0],
  /** The only correct foreground on an aureolin surface. */
  onAccent: bistre[950],
};

/**
 * Flat, restrained radii. Nothing pill-shaped by default, because rounded-full
 * on every control is the tell of a template.
 */
export const radius = {
  none: '0px',
  sm: '2px',
  DEFAULT: '4px',
  md: '6px',
  lg: '10px',
  xl: '14px',
  full: '9999px',
};

/**
 * Borders and flat elevation. Depth comes from a hairline border and a tint,
 * not from a drop shadow. Shadows on every card are the other template tell, and
 * they read badly on the low-end Android screens this ships to.
 */
export const elevation = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(38 22 6 / 0.06)',
  DEFAULT: '0 2px 4px -1px rgb(38 22 6 / 0.08)',
  md: '0 4px 8px -2px rgb(38 22 6 / 0.10)',
  overlay: '0 12px 32px -8px rgb(38 22 6 / 0.22)',
};

export const typography = {
  fontFamily: {
    sans: [
      'Inter var',
      'Inter',
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'sans-serif',
    ],
    mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
    /** Order numbers, money, ETAs. Anything that must not reflow as digits change. */
    numeric: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
  },
  /** Body stays at 16px minimum: this is read one-handed, outdoors, in sunlight. */
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
};

/** Minimum interactive target. Kigali users are tapping this on a moto, in a hurry. */
export const touchTarget = '44px';

export const tokens = {
  aureolin,
  bistre,
  neutral,
  semantic,
  ink,
  radius,
  elevation,
  typography,
  touchTarget,
};

export default tokens;
