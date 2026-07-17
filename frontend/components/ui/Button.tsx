"use client";

// Generic button primitive. Variant/size only — no feature copy or behaviour.
import { cloneElement, forwardRef, isValidElement } from "react";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Render the single child element with these styles instead of a <button>.
   * For links: `<Button asChild><Link href="…">…</Link></Button>` yields a real
   * <a>, since <a><button> is invalid HTML and breaks the a11y tree.
   */
  asChild?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-sans font-medium " +
  "transition-colors duration-150 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-void " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Lime is a light colour — text on it must be void, not the default light text.
  primary: "bg-lime text-void hover:bg-lime/90 active:bg-lime/80",
  ghost: "bg-transparent text-text border border-border hover:bg-card active:bg-card/80",
  destructive: "bg-alert text-void hover:bg-alert/90 active:bg-alert/80",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-label",
  md: "h-10 px-4 text-label",
  lg: "h-12 px-6 text-body",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", type = "button", asChild = false, children, ...props },
    ref
  ) => {
    const classes = cn(base, variants[variant], sizes[size], className);

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<{ className?: string }>;
      // Child className wins last so a caller can still override per-instance.
      return cloneElement(child, {
        ...props,
        ref,
        className: cn(classes, child.props.className),
      } as Partial<unknown> as never);
    }

    return (
      <button
        ref={ref}
        // Defaulting to "button" avoids the implicit "submit" that silently posts
        // any form a caller drops this into.
        type={type}
        className={classes}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
