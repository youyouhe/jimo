import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a Stripe-style webhook signature.
 *
 * The signed payload is `<timestamp>.<rawBody>` and the digest is the hex
 * HMAC-SHA256 of that. The BPM side must sign the exact request body bytes it
 * sends, prefixed with the timestamp and a dot.
 *
 * Comparison is constant-time.
 *
 * @returns true iff the signature matches.
 */
export function verifyBpmSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHex: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');

  const received = Buffer.from(signatureHex);
  const expectedBuf = Buffer.from(expected);

  // Guard length before timingSafeEqual (it throws on mismatched lengths).
  if (received.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(received, expectedBuf);
}
