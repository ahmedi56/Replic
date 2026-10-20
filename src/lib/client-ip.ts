/**
 * The caller's IP, for rate limiting and the security history.
 *
 * `X-Forwarded-For` is a list that every proxy appends to, and a client can pre-fill it with
 * anything. Only the entries added by proxies we run can be trusted, so the address is read
 * from the right: `TRUSTED_PROXY_HOPS` is how many proxies sit in front of the app (1 for
 * Railway, Fly, Render or a single nginx). With 0, no header is trusted and every caller
 * shares one bucket, which is only appropriate for local development.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }
  return process.env.NODE_ENV === 'production' ? 1 : 0;
}

export function clientIp(headers: Pick<Headers, 'get'>, hops = trustedProxyHops()): string {
  if (hops <= 0) return 'local';
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  // Fewer entries than proxies means the request did not come through them: don't guess.
  return chain.length >= hops ? chain[chain.length - hops] : 'unknown';
}
