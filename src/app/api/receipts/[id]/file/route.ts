import { withAuth, notFound } from '@/lib/api';
import { getReceipt } from '@/lib/services/receipts';
import { getDocument } from '@/lib/storage';

export const runtime = 'nodejs';

/** ASCII fallback plus RFC 5987 `filename*`, so names with spaces or accents download intact. */
function contentDisposition(type: 'attachment' | 'inline', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serve an original document.
 *
 * Never static: the lookup is scoped to the caller's organization, and the storage layer
 * re-checks the key prefix. The response is locked down — a sandboxed CSP, nosniff, and
 * no referrer — because the bytes are user-supplied and a PDF can carry active content.
 */
export const GET = withAuth<{ id: string }>(async (auth, req, { id }) => {
  const row = await getReceipt(auth.organizationId, id);
  if (!row) throw notFound('Receipt not found');

  const bytes = await getDocument(auth.organizationId, row.receipt.storageKey);
  const download = new URL(req.url).searchParams.get('download') === '1';

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': row.receipt.mimeType,
      'content-length': String(bytes.length),
      'content-disposition': contentDisposition(download ? 'attachment' : 'inline', row.receipt.originalName),
      'cache-control': 'private, max-age=0, no-store',
      // The document is framed by its own detail page, so the app-wide DENY is narrowed to
      // same-origin here — `frame-ancestors 'self'` is the modern half of the same rule.
      // Everything else stays locked down: the bytes are user-supplied and a PDF can carry
      // active content, so scripts and plugins are refused and the document is sandboxed.
      'content-security-policy':
        "default-src 'none'; img-src 'self'; object-src 'none'; script-src 'none'; frame-ancestors 'self'; sandbox",
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
});
