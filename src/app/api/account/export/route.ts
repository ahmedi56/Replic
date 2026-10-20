import { withAuth, rateLimit } from '@/lib/api';
import { exportAccountData } from '@/lib/services/account';

export const runtime = 'nodejs';

/** Download everything this account holds as JSON. */
export const GET = withAuth(async (auth) => {
  rateLimit(`account-export:${auth.userId}`, 5, 60_000);
  const data = await exportAccountData(auth);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="reclip-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
});
