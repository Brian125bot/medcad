/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: This file is not used if you use the per-platform `css` files.
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./constants/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // CadenceRx design tokens (COR-70)
        cadence: {
          background: "#f8fafc", // Slate-50 — app background
          accent: "#0d9488", // Teal-600 — action accent
          adherence: "#059669", // Emerald-600 — adherence indicator
          alert: "#d97706", // Amber-600 — low-stock alert
        },
      },
      fontFamily: {
        mono: ["SpaceMono", "monospace"],
      },
    },
  },
  plugins: [],
};
