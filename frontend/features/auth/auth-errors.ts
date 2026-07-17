// NextAuth reports failures as opaque codes, either in the ?error= query param it
// appends when redirecting back to the sign-in page, or as `error` on the signIn()
// result. Both are internal identifiers — map every one to something a user can act
// on, and never render the code itself.

/** Shown when NextAuth hands back a code we have no specific wording for. */
const FALLBACK = "Sign-in failed. Try again.";

const MESSAGES: Record<string, string> = {
  // Deliberately identical wording for a bad email and a bad password: saying which
  // one was wrong confirms whether an account exists for that address.
  CredentialsSignin: "Wrong email or password.",

  // The distinctive GitHub case: the email on the GitHub account already belongs to
  // a credentials account, so NextAuth refuses to link them automatically.
  OAuthAccountNotLinked:
    "That email is already registered with a password. Log in with your password instead.",

  OAuthSignin: "Couldn't start GitHub sign-in. Try again.",
  OAuthCallback: "GitHub sign-in didn't complete. Try again.",
  OAuthCreateAccount: "Couldn't create an account from your GitHub profile.",
  EmailCreateAccount: "Couldn't create an account with that email.",
  Callback: "Sign-in didn't complete. Try again.",
  EmailSignin: "Couldn't send the sign-in email.",
  SessionRequired: "Log in to continue.",
  AccessDenied: "You denied access to your GitHub account.",
  Verification: "That sign-in link has expired. Request a new one.",
  Configuration: "Sign-in is misconfigured. Contact an administrator.",
  Default: FALLBACK,
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? FALLBACK;
}
