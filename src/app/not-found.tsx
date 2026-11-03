import Link from 'next/link';
import { ReclipMark } from '@/components/brand';
import { getLocale, makeT } from '@/lib/i18n/server';

export default async function NotFound() {
  const t = makeT(await getLocale());
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center" style={{ background: 'var(--surface-sunken)' }}>
      <ReclipMark size={36} />
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('notFound.body')}
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/app" className="btn btn-accent">
          {t('notFound.dashboard')}
        </Link>
        <Link href="/" className="btn btn-ghost">
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
}
