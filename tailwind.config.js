/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#A6D8B4',
        'primary-deep': '#4A8F6A',
        'primary-light': '#DFF1E5',
        accent: '#94C7E2',
        'accent-2': '#E5B8FF',
        surface: '#F5F7F6',
        'surface-strong': '#E8EEE9',
        border: '#D6E0D9',
        text: '#0E1A14',
        'text-muted': '#32493D',
        // Dark mode tuned lighter for readability
        'surface-dark': '#1C2521',
        'surface-card-dark': '#252F2A',
        'border-dark': '#2F3C35',
        'text-dark': '#FFFFFF',
        'text-muted-dark': '#E6EAE8',
        success: '#3FA66B',
        warning: '#F4C361',
        danger: '#E06262',
      },
    },
  },
  plugins: [],
};
