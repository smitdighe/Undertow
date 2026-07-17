"use client";

// Shared form state, validation and error routing for LoginForm and RegisterForm.
// Both flows fail in the same four ways (field-level, form-level, network, unknown),
// so the handling lives here once rather than being re-derived per form.
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import type { ZodType } from "zod";

/** Attach the message to a specific input (e.g. 409 -> the email field). */
export class AuthFieldError extends Error {
  constructor(
    public field: string,
    message: string
  ) {
    super(message);
    this.name = "AuthFieldError";
  }
}

/** Show above the submit button — applies to the form as a whole. */
export class AuthFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthFormError";
  }
}

/** The request never got an answer. Distinct from a rejected one — retry is the fix. */
export class AuthNetworkError extends Error {
  constructor(message = "Can't reach the server. Check your connection and try again.") {
    super(message);
    this.name = "AuthNetworkError";
  }
}

export type FieldErrors<T> = Partial<Record<keyof T & string, string>>;

interface UseAuthFormOptions<T> {
  schema: ZodType<T>;
  initialValues: T;
  onSubmit: (values: T) => Promise<void>;
}

export function useAuthForm<T extends Record<string, string>>({
  schema,
  initialValues,
  onSubmit,
}: UseAuthFormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<T>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setValue = useCallback((field: keyof T & string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear that field's error as soon as the user edits it — a stale "already
    // registered" sitting under an email they just changed is a lie.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }, []);

  const resetErrors = useCallback(() => {
    setErrors({});
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) return; // guard the double-submit
      resetErrors();

      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        // Mirrors the backend's own parsed.error.flatten().fieldErrors shape.
        const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
        const next: FieldErrors<T> = {};
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (messages?.[0]) next[field as keyof T & string] = messages[0];
        }
        setErrors(next);
        return;
      }

      setSubmitting(true);
      try {
        await onSubmit(parsed.data);
      } catch (error) {
        if (error instanceof AuthFieldError) {
          setErrors((prev) => ({ ...prev, [error.field]: error.message }));
        } else if (error instanceof AuthFormError || error instanceof AuthNetworkError) {
          setFormError(error.message);
        } else {
          // Never surface a raw exception string to the user.
          setFormError("Something went wrong. Try again.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, resetErrors, schema, submitting, values]
  );

  return {
    values,
    setValue,
    errors,
    formError,
    setFormError,
    submitting,
    handleSubmit,
    resetErrors,
  };
}

export default useAuthForm;
