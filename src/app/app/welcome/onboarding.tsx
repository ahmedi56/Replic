'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Spinner, useToast } from '@/components/ui';
import { ReclipMark } from '@/components/brand';

/**
 * First run.
 *
 * The goal is that someone sees matching actually work within a couple of minutes, so the
 * fastest path — loading the demo — is offered as a first-class option next to uploading
 * real files, rather than buried in settings.
 */

const PERSONAS = [
  { value: 'freelancer', label: 'Freelancer', detail: 'A handful of receipts a month, mostly PDFs and photos' },
  { value: 'small_business', label: 'Small business', detail: 'Hundreds a month, VAT to track, duplicates to catch' },
  { value: 'accountant', label: 'Accountant', detail: 'Bulk uploads across clients, exports and audit history' },
  { value: 'other', label: 'Something else', detail: 'Just here to reconcile some receipts' },
];

export function Onboarding({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [persona, setPersona] = useState<string | null>(null);
  const [step, setStep] = useState<'persona' | 'start'>('persona');
  const [busy, setBusy] = useState(false);

  async function choose(value: string) {
    setPersona(value);
    setBusy(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona: value }),
      });
      setStep('start');
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    setBusy(true);
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show(data.error ?? 'Could not load the demo', 'danger');
        return;
      }
      router.push('/app');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (step === 'persona') {
    return (
      <Card className="p-7">
        <ReclipMark size={32} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Welcome to Reclip, {name}</h1>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
          One question, so the defaults suit you. You can change everything later.
        </p>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">What best describes you?</legend>
          <div className="mt-3 grid gap-2">
            {PERSONAS.map((p) => (
              <button
                key={p.value}
                onClick={() => choose(p.value)}
                disabled={busy}
                className="rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]"
                style={persona === p.value ? { borderColor: 'var(--accent)' } : undefined}
              >
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-muted)' }}>
                  {p.detail}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        {toast.node}
      </Card>
    );
  }

  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold tracking-tight">Let&apos;s reconcile something</h1>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        Two ways to start. Either takes a couple of minutes.
      </p>

      <div className="mt-6 grid gap-3">
        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Use your own files</h2>
          <ol className="mt-2 grid gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <li>1. Upload your receipts: drop as many as you like at once</li>
            <li>2. Import a bank CSV and confirm the column mapping</li>
            <li>3. Reclip matches them and shows you only the uncertain ones</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/upload" className="btn btn-accent">
              Upload receipts
            </Link>
            <Link href="/app/import" className="btn btn-ghost">
              Import bank CSV
            </Link>
          </div>
        </div>

        <div className="rounded-lg border p-5">
          <h2 className="text-sm font-semibold">See it working first</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Load a fictional dataset: 26 receipts and 32 transactions, including a duplicate, a few that need review,
            and some with no counterpart. It runs through the real pipeline, so what you see is the product actually
            working.
          </p>
          <button className="btn btn-ghost mt-4" onClick={loadDemo} disabled={busy}>
            {busy && <Spinner />}
            Load demo data
          </button>
        </div>
      </div>

      <Link href="/app" className="mt-5 inline-block text-sm" style={{ color: 'var(--text-muted)' }}>
        Skip for now
      </Link>
      {toast.node}
    </Card>
  );
}
