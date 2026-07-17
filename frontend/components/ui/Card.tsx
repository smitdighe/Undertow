"use client";

// Generic surface primitive built on the card/border tokens.
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Drop the default inner padding when the caller controls its own layout. */
  bare?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, bare = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-card",
        !bare && "p-5",
        className
      )}
      {...props}
    />
  )
);

Card.displayName = "Card";

export default Card;
