import type { Config } from 'tailwindcss';

/**
 * Reclip design system.
 * Deep navy base + teal accent, restrained borders and shadows.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0B1220',
          50: '#F1F3F7',
          100: '#DFE4EC',
          200: '#BCC5D6',
          300: '#8F9CB5',
          400: '#647490',
          500: '#44526B',
          600: '#2E3A50',
          700: '#1D2739',
          800: '#121A28',
          900: '#0B1220',
          950: '#060B14',
        },
        teal: {
          DEFAULT: '#10B981',
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
        },
        mint: '#34D399',
        soft: '#F1F5F9',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(11 18 32 / 0.04), 0 1px 3px 0 rgb(11 18 32 / 0.06)',
        pop: '0 4px 16px -2px rgb(11 18 32 / 0.10), 0 2px 6px -2px rgb(11 18 32 / 0.06)',
      },
      borderRadius: {
        xl: '0.625rem',
        '2xl': '0.875rem',
      },
    },
  },
  plugins: [],
};

export default config;
