/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#E89200',
          light: '#FFB81C',
          dark: '#CC7B00'
        },
        naiwa: {
          gold: '#FFB800',
          honey: '#E89200',
          cream: '#FFF9EB',
          sky: '#D7EFF9',
          ice: '#5BBCE8',
          ink: '#1E293B'
        },
        secondary: {
          DEFAULT: '#64748B',
          light: '#94A3B8',
          dark: '#475569'
        },
        dark: {
          DEFAULT: '#09090B',
          100: '#131316',
          200: '#1C1C22',
          300: '#27272F'
        },
        light: {
          DEFAULT: '#F6FAFD',
          100: '#EEF5FA',
          200: '#E2EDF5',
          300: '#CFE0EC'
        }
      },
      boxShadow: {
        'naiwa-sm': '0 4px 16px rgba(91, 148, 184, 0.08)',
        'naiwa-md': '0 10px 30px rgba(91, 148, 184, 0.12)',
        'naiwa-glow': '0 8px 24px rgba(232, 146, 0, 0.28)'
      }
    }
  },
  plugins: []
};
