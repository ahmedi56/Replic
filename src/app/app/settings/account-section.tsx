'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';
import { useApiError, useLocale, useT } from '@/lib/i18n/client';
import { FORMAT_LOCALE } from '@/lib/i18n/config';
import { messages, type MessageKey } from '@/lib/i18n/messages';

export interface SecurityEventRow {
  id: string;
  type: string;
  ip: string | null;
  createdAt: string;
}


/** Password, personal data and sign-in history: the account, as opposed to the workspace. */
export function AccountSection({ events }: { events: SecurityEventRow[] }) {
  const t = useT();
  const apiError = useApiError();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setPwBusy(true);
    setPwError(null);
    try {
      const res = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: data.get('current'), next: data.get('next') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(apiError(body.error) ?? t('ac.err.password'));
        return;
      }
      form.reset();
      toast.show(t('ac.passwordChanged'));
      router.refresh();
    } finally {
      setPwBusy(false);
    }
  }

  async function deleteAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: data.get('password') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(apiError(body.error) ?? t('ac.err.delete'));
        return;
      }
      router.push('/');
      router.refresh();
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('ac.password')}</h2>
        <form onSubmit={changePassword} className="mt-4 grid max-w-sm gap-4">
          {pwError && <Alert tone="danger">{pwError}</Alert>}
          <div>
            <label className="label" htmlFor="current-password">
              {t('ac.current')}
            </label>
            <input id="current-password" name="current" type="password" required className="input" autoComplete="current-password" />
          </div>
          <div>
            <label className="label" htmlFor="new-password">
              {t('ac.new')}
            </label>
            <input id="new-password" name="next" type="password" required minLength={10} className="input" autoComplete="new-password" />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              {t('ac.newHint')}
            </p>
          </div>
          <div>
            <button className="btn btn-primary" disabled={pwBusy}>
              {pwBusy && <Spinner />}
              {t('ac.change')}
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('ac.activity')}</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('ac.none')}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>{`ac.ev.${event.type}` in messages.en ? t(`ac.ev.${event.type}` as MessageKey) : event.type}</span>
                <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                  {new Date(event.createdAt).toLocaleString(FORMAT_LOCALE[locale])}
                  {event.ip && event.ip !== 'local' ? ` · ${event.ip}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
          {t('ac.suspicious')}
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">{t('ac.yourData')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('ac.yourDataNote')}
        </p>
        <div className="mt-4">
          <a className="btn btn-ghost" href="/api/account/export" download>
            {t('ac.download')}
          </a>
        </div>

        <div className="mt-6 border-t pt-5">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>
            {t('ac.deleteTitle')}
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('ac.deleteNote')}
          </p>
          {!deleteOpen ? (
            <button className="btn btn-danger mt-4" onClick={() => setDeleteOpen(true)}>
              {t('ac.deleteOpen')}
            </button>
          ) : (
            <form onSubmit={deleteAccount} className="mt-4 grid max-w-sm gap-4">
              {deleteError && <Alert tone="danger">{deleteError}</Alert>}
              <div>
                <label className="label" htmlFor="delete-password">
                  {t('ac.confirmPassword')}
                </label>
                <input id="delete-password" name="password" type="password" required className="input" autoComplete="current-password" />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-danger" disabled={deleteBusy}>
                  {deleteBusy && <Spinner />}
                  {t('st.deleteAll')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
                  {t('imp.cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      </Card>

      {toast.node}
    </>
  );
}
