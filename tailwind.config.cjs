/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0f172a",
        panel: "#111827",
        accent: "#38bdf8",
        signal: "#34d399",
        danger: "#fb7185"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(56, 189, 248, 0.18), 0 24px 60px rgba(15, 23, 42, 0.5)"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular"]
      }
    }
  },
  plugins: []
};