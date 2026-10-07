'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner, useToast } from '@/components/ui';

/** Re-runs matching across the workspace — useful after editing fields or weights. */
export function RematchButton({ label = 'Re-run matching' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/matches/run', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? 'Could not re-run matching', 'danger');
        return;
      }
      toast.show(`${data.auto} matched · ${data.review} to review · ${data.unmatched} unmatched`);
      router.refresh();
    } catch {
      toast.show('Could not reach the server', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={run} className="btn btn-ghost" disabled={busy}>
        {busy ? <Spinner /> : null}
        {label}
      </button>
      {toast.node}
    </>
  );
}
