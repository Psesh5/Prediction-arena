import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090f",
          900: "#0b0f18",
          800: "#121826",
          700: "#1b2334",
          600: "#2a3550",
        },
        accent: {
          DEFAULT: "#5b8cff",
          soft: "#8fb0ff",
        },
        gain: "#34d399",
        loss: "#f87171",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
