'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner, useToast } from '@/components/ui';
import { useApiError, useT } from '@/lib/i18n/client';

/** Re-runs matching across the workspace — useful after editing fields or weights. */
export function RematchButton({ label }: { label?: string }) {
  const t = useT();
  const apiError = useApiError();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/matches/run', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(apiError(data.error) ?? t('rematch.failed'), 'danger');
        return;
      }
      toast.show(t('rematch.result', { auto: data.auto, review: data.review, unmatched: data.unmatched }));
      router.refresh();
    } catch {
      toast.show(t('rematch.offline'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={run} className="btn btn-ghost" disabled={busy}>
        {busy ? <Spinner /> : null}
        {label ?? t('rematch.label')}
      </button>
      {toast.node}
    </>
  );
}
