"use client";

// Base badge shell only. Colour and pulse variants arrive in Phase 6 — deliberately
// no severity mapping here, so severity stays owned by the feature layer.
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border",
        "px-2.5 py-0.5 font-mono text-mono-sm uppercase text-muted",
        className
      )}
      {...props}
    />
  )
);

Badge.displayName = "Badge";

export default Badge;
