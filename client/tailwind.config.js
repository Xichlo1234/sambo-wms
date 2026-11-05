/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef3fa', 100: '#d6e2f2', 200: '#adc4e4', 300: '#7c9fd0', 400: '#4f78b6', 500: '#2f5a9a', 600: '#1f447d', 700: '#173564', 800: '#10284d', 900: '#0b2545', 950: '#061529' },
        gold: { 50: '#fdf9ec', 100: '#f9efcc', 200: '#f2dd94', 300: '#e9c75a', 400: '#e0b23a', 500: '#c9971f', 600: '#a87718', 700: '#865a17', 800: '#6f4919', 900: '#5e3d1a' },
      },
      fontFamily: { sans: ['"Be Vietnam Pro"', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
