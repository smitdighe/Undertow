import type { Config } from "tailwindcss";

// Colours resolve through the CSS custom properties declared in styles/tokens.css
// rather than repeating hex literals here — tokens.css stays authoritative and
// both `bg-void` and `var(--color-void)` can never drift apart.
//
// The color-mix wrapper is load-bearing, not decoration. A bare `var(--color-card)`
// gives Tailwind no alpha channel to substitute into, so it emits NO rule at all for
// an opacity modifier: `bg-card/60` became a dead class and the element fell through
// to transparent. Every /NN utility silently did nothing, including the modal's
// bg-void/80 scrim and every button hover state. <alpha-value> is Tailwind's
// substitution point — it becomes 1 when no modifier is present.
const withAlpha = (token: string) =>
  `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: withAlpha("--color-void"),
        card: withAlpha("--color-card"),
        border: withAlpha("--color-border"),
        text: withAlpha("--color-text"),
        muted: withAlpha("--color-muted"),
        lime: withAlpha("--color-lime"),
        alert: withAlpha("--color-alert"),
      },
      fontFamily: {
        // Variables supplied by next/font in lib/fonts.ts, applied in app/layout.tsx.
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["4.5rem", { lineHeight: "1.02", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display-lg": ["3rem", { lineHeight: "1.06", letterSpacing: "-0.02em", fontWeight: "700" }],
        heading: ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["1rem", { lineHeight: "1.6" }],
        label: ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0.01em" }],
        "mono-sm": ["0.75rem", { lineHeight: "1.35", letterSpacing: "0.06em" }],
      },
    },
  },
  plugins: [],
};

export default config;
