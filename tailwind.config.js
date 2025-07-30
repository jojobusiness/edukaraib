/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./frontend/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#00804B',          // Vert Guyane (adaptable)
        'primary-dark': '#005f36',
        secondary: '#FFC107',        // Jaune soleil
      },
    },
  },
  plugins: [],
}