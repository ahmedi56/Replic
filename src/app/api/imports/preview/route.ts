import { NextResponse } from 'next/server';
import { withAuth, rateLimit, clientKey, ApiError } from '@/lib/api';
import { previewCsv } from '@/lib/import/csv';

export const runtime = 'nodejs';

const MAX_CSV_BYTES = 10 * 1024 * 1024;

/** Parse a CSV and return headers, samples and a suggested mapping. Writes nothing. */
export const POST = withAuth(async (_auth, req) => {
  rateLimit(clientKey(req, 'csv-preview'), 30, 60_000);

  const form = await req.formData().catch(() => {
    throw new ApiError(400, 'Upload the file as multipart form data');
  });
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file was received');
  if (file.size > MAX_CSV_BYTES) throw new ApiError(413, 'CSV files are limited to 10MB');

  const content = await file.text();
  if (!content.trim()) throw new ApiError(400, 'That file is empty');
  if (content.includes('\u0000')) throw new ApiError(415, 'That does not look like a CSV file');

  const preview = previewCsv(content);
  if (!preview.headers.length) throw new ApiError(400, 'No columns could be read from that file');

  return NextResponse.json({ ...preview, filename: file.name, content });
});
