import crypto from 'node:crypto';

/** Collision-resistant, URL-safe, and not sequential — ids appear in URLs. */
export function newId(prefix = ''): string {
  const raw = crypto.randomBytes(16).toString('base64url');
  return prefix ? `${prefix}_${raw}` : raw;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison for anything secret. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
