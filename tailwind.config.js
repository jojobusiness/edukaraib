/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./frontend/**/*.{js,jsx,ts,tsx}",   // garde
    "./**/*.{js,jsx,ts,tsx}"             // + au cas où (components externes)
  ],
  theme: {
    extend: {
      colors: {
        primary: '#00804B',
        'primary-dark': '#005f36',
        secondary: '#FFC107',
      },
      screens: {           // ✅ mobile-first clair et net
        xs: '360px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px'
      }
    },
  },
  plugins: [],
}