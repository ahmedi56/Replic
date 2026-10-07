import { withAuth, rateLimit } from '@/lib/api';
import { buildExportCsv, type ExportScope } from '@/lib/services/export';

export const runtime = 'nodejs';

const SCOPES: ExportScope[] = ['all', 'matched', 'review', 'unmatched'];

export const GET = withAuth(async (auth, req) => {
  rateLimit(`export:${auth.organizationId}`, 20, 60_000);

  const requested = new URL(req.url).searchParams.get('scope') as ExportScope | null;
  const scope: ExportScope = requested && SCOPES.includes(requested) ? requested : 'all';

  const csv = await buildExportCsv(auth, scope);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="reclip-${scope}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
