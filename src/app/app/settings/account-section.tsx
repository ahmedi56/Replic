'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spinner, useToast } from '@/components/ui';

export interface SecurityEventRow {
  id: string;
  type: string;
  ip: string | null;
  createdAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  login: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  locked: 'Account locked after repeated failed attempts',
  password_changed: 'Password changed',
  password_reset: 'Password reset by email',
  email_verified: 'Email address confirmed',
};

/** Password, personal data and sign-in history: the account, as opposed to the workspace. */
export function AccountSection({ events }: { events: SecurityEventRow[] }) {
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
        setPwError(body.error ?? 'Could not change the password.');
        return;
      }
      form.reset();
      toast.show('Password changed. Other devices have been signed out');
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
        setDeleteError(body.error ?? 'Could not delete the account.');
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
        <h2 className="text-sm font-semibold">Password</h2>
        <form onSubmit={changePassword} className="mt-4 grid max-w-sm gap-4">
          {pwError && <Alert tone="danger">{pwError}</Alert>}
          <div>
            <label className="label" htmlFor="current-password">
              Current password
            </label>
            <input id="current-password" name="current" type="password" required className="input" autoComplete="current-password" />
          </div>
          <div>
            <label className="label" htmlFor="new-password">
              New password
            </label>
            <input id="new-password" name="next" type="password" required minLength={10} className="input" autoComplete="new-password" />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-subtle)' }}>
              At least 10 characters. This signs you out on every other device.
            </p>
          </div>
          <div>
            <button className="btn btn-primary" disabled={pwBusy}>
              {pwBusy && <Spinner />}
              Change password
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Recent account activity</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>{EVENT_LABEL[event.type] ?? event.type}</span>
                <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                  {new Date(event.createdAt).toLocaleString()}
                  {event.ip && event.ip !== 'local' ? ` · ${event.ip}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
          If you see something you do not recognise, change your password.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Your data</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Download everything this account holds (receipts, transactions, matches, history) as a JSON file.
        </p>
        <div className="mt-4">
          <a className="btn btn-ghost" href="/api/account/export" download>
            Download my data
          </a>
        </div>

        <div className="mt-6 border-t pt-5">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>
            Delete account
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Permanently deletes your account, workspace, receipts, uploaded documents and transactions. This cannot be undone.
          </p>
          {!deleteOpen ? (
            <button className="btn btn-danger mt-4" onClick={() => setDeleteOpen(true)}>
              Delete my account…
            </button>
          ) : (
            <form onSubmit={deleteAccount} className="mt-4 grid max-w-sm gap-4">
              {deleteError && <Alert tone="danger">{deleteError}</Alert>}
              <div>
                <label className="label" htmlFor="delete-password">
                  Confirm with your password
                </label>
                <input id="delete-password" name="password" type="password" required className="input" autoComplete="current-password" />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-danger" disabled={deleteBusy}>
                  {deleteBusy && <Spinner />}
                  Delete everything
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
                  Cancel
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
