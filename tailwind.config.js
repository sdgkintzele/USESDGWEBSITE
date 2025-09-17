/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  darkMode: "class",

  content: [
    "./public/index.html",
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],

  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        lg: "2rem",
      },
    },
    extend: {
      /* --- Brand / UI colors --- */
      colors: {
        sdg: {
          charcoal: "#2B2F33", // primary text / headers
          dark: "#3A4147", // UI chrome, borders
          slate: "#6B7280", // secondary text (used in code as text-sdg-slate)
          bronze: "#B4835B", // logo bronze
          sand: "#D0A777", // light gold
          paper: "#F7F7F5", // off-white background
        },
      },

      /* --- Typography --- */
      fontFamily: {
        // Body
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        // Headings: use className="font-heading"
        heading: ['"League Spartan"', "Inter", ...defaultTheme.fontFamily.sans],
      },

      /* --- Visual polish --- */
      backgroundImage: {
        "sdg-gold": "linear-gradient(90deg, #B4835B 0%, #D0A777 100%)",
      },
      boxShadow: {
        soft: "0 2px 12px rgba(0,0,0,0.06)",
        card: "0 1px 1px rgb(0 0 0 / 0.04), 0 2px 4px rgb(0 0 0 / 0.06)",
      },
      borderRadius: {
        "2xl": "1rem",
      },
    },
  },

  plugins: [
    require("@tailwindcss/forms"), // you added this—kept enabled
  ],
};
