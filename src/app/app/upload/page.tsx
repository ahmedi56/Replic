import { UploadDropzone } from './dropzone';
import { getLocale, makeT } from '@/lib/i18n/server';

export async function generateMetadata() {
  return { title: makeT(await getLocale())('up.title') };
}

export default async function UploadPage() {
  const t = makeT(await getLocale());
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">{t('up.title')}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('up.sub')}
      </p>
      <div className="mt-6">
        <UploadDropzone />
      </div>
    </div>
  );
}
