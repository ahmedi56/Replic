'use client';

import { useState } from 'react';
import type { ExportScope } from '@/lib/services/export';

const SCOPES: Array<{ value: ExportScope; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'matched', label: 'Matched only' },
  { value: 'review', label: 'Needs review only' },
  { value: 'unmatched', label: 'Unmatched only' },
];

/** Export is a plain download, so it works without JavaScript state juggling. */
export function ExportMenu({ defaultScope = 'all' }: { defaultScope?: ExportScope }) {
  const [scope, setScope] = useState<ExportScope>(defaultScope);

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="export-scope">
        What to export
      </label>
      <select id="export-scope" className="input w-auto py-1.5 text-xs" value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
        {SCOPES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <a href={`/api/export?scope=${scope}`} className="btn btn-ghost text-xs" download>
        Export CSV
      </a>
    </div>
  );
}
