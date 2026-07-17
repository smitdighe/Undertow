"use client";

// Generic text input primitive: optional leading icon slot, error state, and an
// opt-in password-visibility toggle. No labels or copy — callers own those.
import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered inside the field, leading edge. Decorative — kept out of the a11y tree. */
  icon?: ReactNode;
  /** String renders as a message; bare true marks the field invalid silently. */
  error?: string | boolean;
  /** Adds a show/hide control. Only meaningful with type="password". */
  revealable?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, error, revealable = false, type = "text", id, ...props }, ref) => {
    const [revealed, setRevealed] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    const hasError = Boolean(error);
    const showToggle = revealable && type === "password";
    const resolvedType = showToggle && revealed ? "text" : type;

    return (
      <div className="w-full">
        <div className="relative">
          {icon && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            >
              {icon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            type={resolvedType}
            aria-invalid={hasError || undefined}
            // Only point at the error node when there is message text to read.
            aria-describedby={typeof error === "string" ? errorId : undefined}
            className={cn(
              "h-10 w-full rounded-lg border bg-card font-sans text-body text-text",
              "placeholder:text-muted outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-void",
              "disabled:cursor-not-allowed disabled:opacity-50",
              icon ? "pl-10" : "pl-3",
              showToggle ? "pr-10" : "pr-3",
              hasError
                ? "border-alert focus-visible:ring-alert"
                : "border-border focus-visible:ring-lime",
              className
            )}
            {...props}
          />

          {showToggle && (
            <button
              type="button"
              // Label describes the action, and flips with state so it stays truthful.
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              onClick={() => setRevealed((v) => !v)}
              className={cn(
                "absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center",
                "rounded text-muted transition-colors hover:text-text",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime"
              )}
            >
              <EyeIcon closed={revealed} />
            </button>
          )}
        </div>

        {typeof error === "string" && (
          <p id={errorId} role="alert" className="mt-1.5 font-sans text-label text-alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {closed && <path d="m4 4 16 16" />}
    </svg>
  );
}

export default Input;
