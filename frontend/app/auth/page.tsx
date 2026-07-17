import { Auth } from "@/features/auth";
import { safeCallbackUrl } from "@/lib/utils/callback-url";

// Server component so ?error= / ?callbackUrl= are read from props rather than
// useSearchParams, which would force a client Suspense boundary here.
export default function AuthPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  // Sanitised before it ever reaches the client: the raw value is attacker-supplied.
  const callbackUrl = safeCallbackUrl(searchParams.callbackUrl);
  return <Auth callbackUrl={callbackUrl} error={searchParams.error ?? null} />;
}
