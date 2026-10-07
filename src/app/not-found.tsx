import Link from 'next/link';
import { ReclipMark } from '@/components/brand';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center" style={{ background: 'var(--surface-sunken)' }}>
      <ReclipMark size={36} />
      <h1 className="mt-5 text-xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        The link may be out of date, or the item may have been deleted.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/app" className="btn btn-accent">
          Go to dashboard
        </Link>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>
    </div>
  );
}
