"use client";

// Credentials login. GitHub OAuth lives in AuthTabs since it is shared by both tabs.
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { Button, Input } from "@/components/ui";
import { safeCallbackUrl } from "@/lib/utils/callback-url";
import { authErrorMessage } from "../auth-errors";
import { useAuthForm, AuthFormError, AuthNetworkError } from "../hooks/useAuthForm";

// Login only checks presence. The 8-char rule is a registration constraint; enforcing
// it here would reject a legacy password and leak the policy to an attacker probing.
const loginSchema = z.object({
  email: z.string().min(1, "Enter your email.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();

  const form = useAuthForm<LoginValues>({
    schema: loginSchema,
    initialValues: { email: "", password: "" },
    onSubmit: async (values) => {
      let result;
      try {
        // redirect:false so a failure re-renders inline instead of bouncing to
        // NextAuth's own ?error= page and losing what the user typed.
        result = await signIn("credentials", {
          email: values.email,
          password: values.password,
          redirect: false,
          callbackUrl,
        });
      } catch {
        throw new AuthNetworkError();
      }

      if (!result) throw new AuthNetworkError();

      if (result.error) {
        throw new AuthFormError(authErrorMessage(result.error) ?? "Sign-in failed. Try again.");
      }

      if (!result.ok) throw new AuthFormError("Sign-in failed. Try again.");

      router.push(safeCallbackUrl(result.url ?? callbackUrl));
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <label htmlFor="login-email" className="mb-1.5 block text-label text-muted">
          Email
        </label>
        <Input
          id="login-email"
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
        <label htmlFor="login-password" className="mb-1.5 block text-label text-muted">
          Password
        </label>
        <Input
          id="login-password"
          name="password"
          type="password"
          revealable
          autoComplete="current-password"
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
        // Label stays "Log in" throughout: aria-busy carries the pending state, so
        // the verb never changes under the user mid-flow.
        aria-busy={form.submitting}
      >
        Log in
      </Button>
    </form>
  );
}

export default LoginForm;
