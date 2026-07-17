import type { Metadata } from "next";
import { spaceGrotesk, inter, jetbrainsMono } from "@/lib/fonts";
// Tokens + Tailwind layers — the only global stylesheet. (create-next-app's
// globals.css was deleted in Phase 8: its unlayered body rules outranked
// Tailwind's @layer base and would defeat the dark token palette.)
import "@/styles/tokens.css";

export const metadata: Metadata = {
  title: "Undertow",
  description: "AI incident triage",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
