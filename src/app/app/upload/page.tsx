import { UploadDropzone } from './dropzone';

export const metadata = { title: 'Upload receipts' };

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Upload receipts</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        JPG, PNG, WEBP or PDF. Drop a hundred at once. They process in the background and you can keep working.
      </p>
      <div className="mt-6">
        <UploadDropzone />
      </div>
    </div>
  );
}
