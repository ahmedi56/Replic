'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pagination } from '@/components/ui';

/** Pagination that writes the page number into the URL. */
export function ServerPagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      onChange={(next) => {
        const query = new URLSearchParams(params.toString());
        query.set('page', String(next));
        router.push(`${pathname}?${query.toString()}`);
      }}
    />
  );
}
