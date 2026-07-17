// className merge helper — clsx resolves conditionals, tailwind-merge drops
// earlier utilities that later ones conflict with (so a caller's `bg-card`
// overrides a primitive's default `bg-void` instead of racing on source order).
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge ships with stock Tailwind's scales only, so our custom tokens are
// unclassifiable to it and get guessed at — it read `text-label` as a text COLOUR and
// silently dropped the `text-void` beside it, turning lime buttons unreadable. Teach
// it every custom scale from tailwind.config.ts so conflicts resolve in the right group.
const FONT_SIZES = ["display-xl", "display-lg", "heading", "body", "label", "mono-sm"];
const COLORS = ["void", "card", "border", "text", "muted", "lime", "alert"];
const FONT_FAMILIES = ["display", "sans", "mono"];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
      "font-family": [{ font: FONT_FAMILIES }],
      "text-color": [{ text: COLORS }],
      "bg-color": [{ bg: COLORS }],
      "border-color": [{ border: COLORS }],
      "ring-color": [{ ring: COLORS }],
      "ring-offset-color": [{ "ring-offset": COLORS }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export default cn;
