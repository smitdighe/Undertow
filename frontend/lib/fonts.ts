// next/font loaders for the three project typefaces. Exposed as CSS variables so
// tailwind.config.ts can bind them to font-display / font-sans / font-mono.
// Wiring: spread these `.variable` classes onto <html> or <body> in app/layout.tsx.
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
