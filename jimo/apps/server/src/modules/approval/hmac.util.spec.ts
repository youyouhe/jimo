import * as crypto from 'crypto';
import { verifyBpmSignature } from './hmac.util';

/**
 * Pins the BPM→NestJS webhook signing contract. The Java side
 * (ApprovalWebhookPublisher) signs `timestamp + "." + body` with hex
 * HMAC-SHA256 using the shared secret; these tests assert the NestJS verifier
 * agrees and rejects tampering. Keep this in sync with the BPM publisher.
 */
describe('verifyBpmSignature', () => {
  const SECRET = 'test-secret';
  const body = JSON.stringify({
    businessType: 'contract',
    businessId: 'c-1',
    processInstanceId: 'pi-1',
    status: 'APPROVED',
    approverId: 'EMP008',
    comment: 'ok',
    occurredAt: '1718772000000',
  });

  const sign = (timestamp: string, payload: string, secret = SECRET) =>
    crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

  it('accepts a correctly signed payload', () => {
    const ts = '1718772000000';
    expect(verifyBpmSignature(SECRET, ts, Buffer.from(body), sign(ts, body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = '1718772000000';
    expect(
      verifyBpmSignature(SECRET, ts, Buffer.from(body + 'x'), sign(ts, body)),
    ).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const ts = '1718772000000';
    expect(
      verifyBpmSignature(SECRET, ts, Buffer.from(body), sign(ts, body, 'other-secret')),
    ).toBe(false);
  });

  it('rejects a malformed (wrong-length) signature without throwing', () => {
    const ts = '1718772000000';
    expect(verifyBpmSignature(SECRET, ts, Buffer.from(body), 'deadbeef')).toBe(false);
  });
});
