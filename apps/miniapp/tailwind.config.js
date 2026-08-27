/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Both stacks live in styles.css as tokens so the system-first UI face and
        // the display face stay in step wherever they are referenced.
        sans: ['var(--font-ui)'],
        display: ['var(--font-display)'],
      },
      colors: {
        ink: '#0d0b12',
        plum: '#6d42d8',
        lilac: '#b9a1ff',
        parchment: '#f4efff',
      },
      boxShadow: {
        glow: '0 20px 70px rgba(109, 66, 216, .28)',
      },
    },
  },
  plugins: [],
};
