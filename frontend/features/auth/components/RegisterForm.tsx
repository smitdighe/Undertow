"use client";

// Registration: POST /api/register, then sign the new user straight in — making them
// retype the credentials they just chose would be a pointless second step.
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { Button, Input } from "@/components/ui";
import { safeCallbackUrl } from "@/lib/utils/callback-url";
import { authErrorMessage } from "../auth-errors";
import {
  useAuthForm,
  AuthFieldError,
  AuthFormError,
  AuthNetworkError,
} from "../hooks/useAuthForm";

// Mirrors backend/app/api/register/route.ts registerSchema: email(), password min 8,
// username 1..39 optional. Validating here saves a round-trip; the backend still
// re-validates, so this is convenience and never the security boundary.
// `username` is a plain string here, not optional: the input always holds one. An
// empty value means "let the backend default it" and is dropped from the payload
// below, which keeps the form's value type a clean Record<string, string>.
const registerSchema = z.object({
  email: z.string().min(1, "Enter your email.").email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  username: z.string().max(39, "Use 39 characters or fewer."),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();

  const form = useAuthForm<RegisterValues>({
    schema: registerSchema,
    initialValues: { email: "", password: "", username: "" },
    onSubmit: async (values) => {
      let response: Response;
      try {
        response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email,
            password: values.password,
            // Backend defaults username to the email local-part when omitted, so
            // send undefined rather than "" (which would fail its min(1)).
            username: values.username.trim() || undefined,
          }),
        });
      } catch {
        // fetch only rejects on a transport failure — a 4xx/5xx resolves normally.
        throw new AuthNetworkError();
      }

      if (!response.ok) {
        await handleRegisterError(response);
      }

      // Registered. Sign in with the same credentials.
      let result;
      try {
        result = await signIn("credentials", {
          email: values.email,
          password: values.password,
          redirect: false,
          callbackUrl,
        });
      } catch {
        throw new AuthNetworkError(
          "Account created, but sign-in couldn't reach the server. Try logging in."
        );
      }

      if (!result || result.error || !result.ok) {
        // The account exists at this point, so send them to the login tab rather
        // than implying registration failed.
        throw new AuthFormError(
          authErrorMessage(result?.error) ?? "Account created. Log in to continue."
        );
      }

      router.push(safeCallbackUrl(result.url ?? callbackUrl));
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <label htmlFor="register-email" className="mb-1.5 block text-label text-muted">
          Email
        </label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.values.email}
          onChange={(e) => form.setValue("email", e.target.value)}
          error={form.errors.email}
          disabled={form.submitting}
        />
      </div>

      <div>
        <label htmlFor="register-username" className="mb-1.5 block text-label text-muted">
          {/* Full-strength muted: a /70 layer fell to ~3.3:1 on the glass card, under AA. */}
          Username (optional)
        </label>
        <Input
          id="register-username"
          name="username"
          autoComplete="username"
          value={form.values.username}
          onChange={(e) => form.setValue("username", e.target.value)}
          error={form.errors.username}
          disabled={form.submitting}
        />
      </div>

      <div>
        <label htmlFor="register-password" className="mb-1.5 block text-label text-muted">
          Password
        </label>
        <Input
          id="register-password"
          name="password"
          type="password"
          revealable
          autoComplete="new-password"
          value={form.values.password}
          onChange={(e) => form.setValue("password", e.target.value)}
          error={form.errors.password}
          disabled={form.submitting}
        />
      </div>

      {form.formError && (
        <p role="alert" className="text-label text-alert">
          {form.formError}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="mt-2 w-full"
        disabled={form.submitting}
        aria-busy={form.submitting}
      >
        Create account
      </Button>
    </form>
  );
}

/** Translate a non-2xx /api/register response into the right error class. Always throws. */
async function handleRegisterError(response: Response): Promise<never> {
  let body: { error?: string; details?: Record<string, string[]> } = {};
  try {
    body = await response.json();
  } catch {
    // A non-JSON error body (proxy/gateway HTML) still tells us the status.
  }

  if (response.status === 409) {
    throw new AuthFieldError("email", "An account with this email already exists");
  }

  if (response.status === 400) {
    // Backend shape: { error: "Validation failed", details: { field: [msg] } }
    const firstField = body.details && Object.keys(body.details)[0];
    if (firstField && body.details?.[firstField]?.[0]) {
      throw new AuthFieldError(firstField, body.details[firstField][0]);
    }
    throw new AuthFormError("Check your details and try again.");
  }

  if (response.status >= 500) {
    throw new AuthFormError("The server couldn't create your account. Try again.");
  }

  throw new AuthFormError("Couldn't create your account. Try again.");
}

export default RegisterForm;
