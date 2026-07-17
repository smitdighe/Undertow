import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify GitHub's HMAC-SHA256 webhook signature (X-Hub-Signature-256 header,
 * format "sha256=<hex>") against the raw request body.
 *
 * Uses crypto.timingSafeEqual — a plain === comparison would leak how many
 * leading characters of the signature are correct via response timing.
 */
export function verifyGitHubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const received = Buffer.from(signatureHeader, "utf8");
  const computed = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on length mismatch; length is not secret here
  // (hex digest length is public knowledge), so an early return is safe.
  if (received.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(received, computed);
}
