/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fff7f4',
        blush: {
          50: '#fef4f3',
          100: '#fde8e6',
          200: '#fbd4d1',
          300: '#f7b3ae',
          400: '#f08a85',
          500: '#e8747c',
          600: '#d2545f',
          700: '#b03e4c',
          800: '#933742',
          900: '#7d323d',
        },
        sage: {
          100: '#e8f1ea',
          300: '#b6d3bd',
          500: '#7aab86',
          700: '#4f7a5c',
        },
        ink: {
          400: '#8b8078',
          600: '#5c534d',
          900: '#2f2a27',
        },
      },
      fontFamily: {
        sans: ['"Nunito"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        card: '1.5rem',
      },
      boxShadow: {
        soft: '0 8px 30px -12px rgba(79, 55, 48, 0.18)',
        lift: '0 12px 40px -16px rgba(79, 55, 48, 0.28)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
