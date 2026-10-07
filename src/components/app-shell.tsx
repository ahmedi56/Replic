'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ReclipWordmark } from './brand';

/**
 * Application chrome: a persistent sidebar on desktop, a slide-over on mobile.
 * The nav is grouped by the reconciliation loop, so the sidebar reads as the workflow.
 */

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: ReactNode }> }> = [
  {
    group: 'Overview',
    items: [
      { href: '/app', label: 'Dashboard', icon: <IconGrid /> },
      { href: '/app/review', label: 'Needs review', icon: <IconFlag /> },
      { href: '/app/matches', label: 'Matched', icon: <IconCheck /> },
      { href: '/app/unmatched', label: 'Unmatched', icon: <IconSplit /> },
    ],
  },
  {
    group: 'Data',
    items: [
      { href: '/app/receipts', label: 'Receipts', icon: <IconReceipt /> },
      { href: '/app/transactions', label: 'Transactions', icon: <IconBank /> },
    ],
  },
  {
    group: 'Add',
    items: [
      { href: '/app/upload', label: 'Upload receipts', icon: <IconUpload /> },
      { href: '/app/import', label: 'Import bank CSV', icon: <IconCsv /> },
    ],
  },
];

export function AppShell({ children, userName, organizationName }: { children: ReactNode; userName: string; organizationName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem('reclip-theme');
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  function toggleTheme() {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('reclip-theme', next);
    setTheme(next);
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const nav = (
    <nav className="grid gap-6" aria-label="Main">
      {NAV.map((section) => (
        <div key={section.group}>
          <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
            {section.group}
          </p>
          <ul className="grid gap-0.5">
            {section.items.map((item) => {
              const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                    style={{
                      background: active ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
                      color: active ? 'var(--accent-ink)' : 'var(--text-muted)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span className="shrink-0 opacity-80">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r px-3 py-5 lg:flex" style={{ background: 'var(--surface)' }}>
        <Link href="/app" className="mb-7 px-3">
          <ReclipWordmark />
        </Link>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-4 border-t px-3 pt-4">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs" style={{ color: 'var(--text-subtle)' }}>
            {organizationName}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link href="/app/settings" className="btn btn-ghost flex-1 px-2 py-1.5 text-xs">
              Settings
            </Link>
            <button onClick={signOut} className="btn btn-ghost px-2 py-1.5 text-xs">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 lg:hidden" style={{ background: 'var(--surface)' }}>
        <button
          onClick={() => setMobileOpen(true)}
          className="btn btn-ghost px-2 py-1.5"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <Link href="/app">
          <ReclipWordmark />
        </Link>
        <button onClick={toggleTheme} className="btn btn-ghost px-2 py-1.5" aria-label="Toggle dark mode">
          <IconTheme />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0" aria-hidden="true" style={{ background: 'rgb(11 18 32 / 0.5)' }} onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r px-3 py-5" style={{ background: 'var(--surface)' }}>
            <div className="mb-7 flex items-center justify-between px-3">
              <ReclipWordmark />
              <button onClick={() => setMobileOpen(false)} className="btn btn-ghost px-2 py-1" aria-label="Close navigation">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="mt-4 border-t px-3 pt-4">
              <p className="truncate text-sm font-medium">{userName}</p>
              <div className="mt-3 flex gap-2">
                <Link href="/app/settings" className="btn btn-ghost flex-1 px-2 py-1.5 text-xs">
                  Settings
                </Link>
                <button onClick={signOut} className="btn btn-ghost px-2 py-1.5 text-xs">
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <div className="hidden justify-end border-b px-6 py-2.5 lg:flex" style={{ background: 'var(--surface)' }}>
          <button onClick={toggleTheme} className="btn btn-ghost px-2 py-1.5 text-xs" aria-label="Toggle dark mode">
            <IconTheme />
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/* --- icons: inline so there's no icon-library dependency --- */
function base(children: ReactNode) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function IconGrid() { return base(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>); }
function IconFlag() { return base(<><path d="M4 21V4h11l-1.5 3.5L15 11H4" /><path d="M4 4h16" opacity="0" /></>); }
function IconCheck() { return base(<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.5 2.5 4.6-5" /></>); }
function IconSplit() { return base(<><path d="M4 7h6l4 10h6" /><path d="M17 4l3 3-3 3" /><path d="M4 17h6" /></>); }
function IconReceipt() { return base(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>); }
function IconBank() { return base(<><path d="M3 10h18M5 10v8M19 10v8M3 18h18M12 3l9 5H3l9-5Z" /></>); }
function IconUpload() { return base(<><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>); }
function IconCsv() { return base(<><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h4" /></>); }
function IconTheme() { return base(<><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" /></>); }
