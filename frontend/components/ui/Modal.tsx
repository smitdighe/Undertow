"use client";

// Modal shell: portal, overlay, scroll lock, esc-to-close, focus trap, focus restore.
// Deliberately contentless — no header, footer, or copy. Callers supply children.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
  /** Clicking the overlay dismisses. Disable for flows that must not be lost. */
  closeOnOverlayClick?: boolean;
  /** Accessible name. Prefer aria-labelledby when the caller renders a heading. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  open,
  onClose,
  children,
  className,
  closeOnOverlayClick = true,
  ...aria
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Portals need a real document, which does not exist during SSR.
  useEffect(() => setMounted(true), []);

  const getFocusable = useCallback(
    () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      ),
    []
  );

  // Remember the trigger so focus can go back where it came from on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  // Move focus into the dialog once it exists.
  useEffect(() => {
    if (!open || !mounted) return;
    const focusables = getFocusable();
    // Fall back to the panel itself (tabIndex -1) when there is nothing focusable
    // inside, so focus never stays stranded on the page behind the overlay.
    (focusables[0] ?? panelRef.current)?.focus();
  }, [open, mounted, getFocusable]);

  // Esc to close + Tab cycling.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusables = getFocusable();
      if (focusables.length === 0) {
        // Nothing to cycle through — keep focus pinned inside the dialog.
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      // Wrap at both ends. Also catches focus sitting on the panel itself.
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, getFocusable]);

  // Scroll lock, restoring whatever the page had rather than assuming "".
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Plain scrim, no backdrop-blur: the glass treatment is scoped to /auth
          only, and this modal renders on the dashboard. */}
      <div
        aria-hidden="true"
        onClick={closeOnOverlayClick ? onClose : undefined}
        className="absolute inset-0 bg-void/80"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-xl border border-border bg-card",
          "shadow-2xl outline-none",
          className
        )}
        {...aria}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
