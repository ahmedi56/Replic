'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, ProgressBar, Spinner } from '@/components/ui';

/**
 * Bulk upload.
 *
 * Files are posted one at a time with a small concurrency window rather than in one giant
 * request: progress is real (it reflects completed files, not bytes buffered), one bad
 * file fails on its own, and the interface never blocks — the whole point of "drop 100
 * files here" is that you can walk away.
 */

const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';
const CONCURRENCY = 3;

interface FileState {
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  error?: string;
  receiptId?: string;
  merchantLabel?: string;
  matched?: boolean;
  duplicate?: boolean;
}

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileState[]>([]);
  const [running, setRunning] = useState(false);

  const processed = files.filter((f) => f.status === 'done' || f.status === 'failed').length;
  const succeeded = files.filter((f) => f.status === 'done').length;
  const failed = files.filter((f) => f.status === 'failed');
  const duplicates = files.filter((f) => f.duplicate).length;
  const matched = files.filter((f) => f.matched).length;

  const upload = useCallback(
    async (selected: File[]) => {
      if (!selected.length) return;
      const startIndex = files.length;
      setFiles((prev) => [...prev, ...selected.map((f) => ({ name: f.name, status: 'queued' as const }))]);
      setRunning(true);

      let cursor = 0;
      async function worker() {
        while (cursor < selected.length) {
          const myIndex = cursor++;
          const file = selected[myIndex];
          const stateIndex = startIndex + myIndex;

          setFiles((prev) => prev.map((f, i) => (i === stateIndex ? { ...f, status: 'uploading' } : f)));

          try {
            const body = new FormData();
            body.append('file', file);
            const res = await fetch('/api/receipts', { method: 'POST', body });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
              setFiles((prev) =>
                prev.map((f, i) => (i === stateIndex ? { ...f, status: 'failed', error: data.error ?? 'Upload failed' } : f)),
              );
              continue;
            }

            setFiles((prev) =>
              prev.map((f, i) =>
                i === stateIndex
                  ? {
                      ...f,
                      status: 'done',
                      receiptId: data.receiptId,
                      matched: Boolean(data.matchedTransactionId),
                      duplicate: Boolean(data.duplicateOf),
                    }
                  : f,
              ),
            );
          } catch {
            setFiles((prev) =>
              prev.map((f, i) => (i === stateIndex ? { ...f, status: 'failed', error: 'Network error' } : f)),
            );
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, worker));
      setRunning(false);
      router.refresh();
    },
    [files.length, router],
  );

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    upload(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="grid gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="card flex flex-col items-center justify-center px-6 py-14 text-center transition-colors"
        style={{
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: dragging ? 'var(--accent)' : 'var(--border-strong)',
          background: dragging ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : 'var(--surface-raised)',
        }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className="opacity-35" aria-hidden="true">
          <path d="M12 16V4M8 8l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <p className="mt-4 text-sm font-medium">Drop your receipts here</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          or choose files from your device
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-accent" onClick={() => inputRef.current?.click()}>
            Choose files
          </button>
          {/* Mobile: opens the camera directly. */}
          <label className="btn btn-ghost cursor-pointer sm:hidden">
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                upload(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Choose receipt files to upload"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <p className="mt-4 text-xs" style={{ color: 'var(--text-subtle)' }}>
          JPG · PNG · WEBP · PDF · up to 15MB each
        </p>
      </div>

      {files.length > 0 && (
        <Card className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{running ? 'Processing receipts…' : 'Finished'}</p>
            <p className="num text-sm" style={{ color: 'var(--text-muted)' }}>
              {processed} / {files.length} processed
            </p>
          </div>
          <div className="mt-3">
            <ProgressBar value={(processed / files.length) * 100} label="Upload progress" />
          </div>

          {!running && (
            <div className="mt-5 grid gap-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="chip" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent-ink)' }}>
                  {succeeded} processed
                </span>
                {matched > 0 && (
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent-ink)' }}>
                    {matched} matched automatically
                  </span>
                )}
                {duplicates > 0 && (
                  <span className="chip" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
                    {duplicates} possible duplicate{duplicates === 1 ? '' : 's'}
                  </span>
                )}
                {failed.length > 0 && (
                  <span className="chip" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {failed.length} failed
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href="/app/review" className="btn btn-accent text-xs">
                  Review matches
                </Link>
                <Link href="/app/receipts" className="btn btn-ghost text-xs">
                  See all receipts
                </Link>
                <button className="btn btn-ghost text-xs" onClick={() => setFiles([])}>
                  Clear list
                </button>
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div className="mt-4">
              <Alert tone="danger" title={`${failed.length} file${failed.length === 1 ? '' : 's'} couldn't be processed`}>
                <ul className="mt-1 grid gap-1">
                  {failed.slice(0, 5).map((f) => (
                    <li key={f.name} className="truncate text-xs">
                      {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">
                  You can try again, or{' '}
                  <Link href="/app/receipts" className="link">
                    add the details manually
                  </Link>
                  .
                </p>
              </Alert>
            </div>
          )}

          {/* Per-file list, capped so a 200-file drop doesn't build a 200-row DOM. */}
          <ul className="mt-4 grid max-h-60 gap-1 overflow-y-auto">
            {files.slice(-40).map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-xs">
                <span className="w-4 shrink-0 text-center" aria-hidden="true">
                  {f.status === 'done' ? '✓' : f.status === 'failed' ? '×' : f.status === 'uploading' ? <Spinner size={12} /> : '·'}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: f.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {f.name}
                </span>
                {f.duplicate && <span style={{ color: 'var(--warn)' }}>duplicate</span>}
                {f.matched && <span style={{ color: 'var(--accent-ink)' }}>matched</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
