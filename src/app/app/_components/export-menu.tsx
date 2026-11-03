'use client';

import { useState } from 'react';
import type { ExportScope } from '@/lib/services/export';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

const SCOPES: Array<{ value: ExportScope; label: MessageKey }> = [
  { value: 'all', label: 'exp.all' },
  { value: 'matched', label: 'exp.matched' },
  { value: 'review', label: 'exp.review' },
  { value: 'unmatched', label: 'exp.unmatched' },
];

/** Export is a plain download, so it works without JavaScript state juggling. */
export function ExportMenu({ defaultScope = 'all' }: { defaultScope?: ExportScope }) {
  const t = useT();
  const [scope, setScope] = useState<ExportScope>(defaultScope);

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="export-scope">
        {t('exp.label')}
      </label>
      <select id="export-scope" className="input w-auto py-1.5 text-xs" value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
        {SCOPES.map((s) => (
          <option key={s.value} value={s.value}>
            {t(s.label)}
          </option>
        ))}
      </select>
      <a href={`/api/export?scope=${scope}`} className="btn btn-ghost text-xs" download>
        {t('exp.csv')}
      </a>
    </div>
  );
}
