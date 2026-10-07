'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDebounced } from '@/components/ui';

/** Debounced, URL-backed search so results are shareable and the back button works. */
export function SearchBar({ placeholder = 'Search…', children }: { placeholder?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const debounced = useDebounced(value, 350);
  const urlQuery = params.get('q') ?? '';
  const lastSeenUrlQuery = useRef(urlQuery);

  // The URL can change without typing (back/forward, a link). Follow it, otherwise the box
  // keeps stale text and the effect below would write that text back over the new URL.
  useEffect(() => {
    if (urlQuery !== lastSeenUrlQuery.current) {
      lastSeenUrlQuery.current = urlQuery;
      setValue(urlQuery);
    }
  }, [urlQuery]);

  useEffect(() => {
    const current = params.get('q') ?? '';
    if (value !== debounced) return; // still typing, or catching up to the URL
    if (debounced === current) return;
    lastSeenUrlQuery.current = debounced;

    const next = new URLSearchParams(params.toString());
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    next.delete('page'); // a new search starts at page one
    router.replace(`${pathname}?${next.toString()}`);
  }, [value, debounced, params, pathname, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="input pl-9"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={placeholder}
        />
      </div>
      {children}
    </div>
  );
}

/** A URL-backed <select> used for the status / sort / category filters. */
export function FilterSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(name) ?? '';

  return (
    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        className="input w-auto py-1.5 text-xs"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          next.delete('page');
          router.replace(`${pathname}?${next.toString()}`);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
