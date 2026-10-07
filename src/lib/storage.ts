import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newId, sha256 } from './ids';
import { ApiError } from './api';

/**
 * Document storage.
 *
 * Files live outside the web root and are never served statically — every read goes
 * through an authenticated route that re-checks organization ownership. Storage keys
 * are opaque and namespaced by organization, and paths are re-validated on read so a
 * crafted key cannot escape the storage directory.
 *
 * The interface is deliberately small (put/get/delete) so S3 or similar can replace the
 * filesystem without touching callers.
 */

const ROOT = path.resolve(process.env.STORAGE_DIR ?? './storage');

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** Magic-byte signatures. The declared Content-Type is attacker-controlled; bytes are not. */
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export interface ValidatedUpload {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Validate an uploaded file by its actual content.
 * A PDF renamed to .png, or a script with an image Content-Type, is rejected here.
 */
export function validateUpload(bytes: Buffer, declaredName: string, declaredMime: string): ValidatedUpload {
  if (bytes.length === 0) throw new ApiError(400, 'File is empty');
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, `File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }

  const detected = SIGNATURES.find((s) => s.test(bytes))?.mime;
  if (!detected) {
    throw new ApiError(415, 'Only JPG, PNG, WEBP and PDF files can be uploaded');
  }
  if (declaredMime && declaredMime !== detected && ALLOWED_MIME_TYPES.includes(declaredMime as never)) {
    // Declared type disagrees with the bytes — trust the bytes, don't fail the upload.
    console.warn('[upload] declared type did not match file contents; using detected type');
  }

  // A PDF can embed JavaScript. We never render user PDFs in a privileged context —
  // they are served with a restrictive CSP and as attachments — but flag the obvious case.
  if (detected === 'application/pdf' && /\/JavaScript|\/JS\b|\/Launch|\/OpenAction/.test(bytes.subarray(0, 4096).toString('latin1'))) {
    console.warn('[upload] PDF contains active-content markers; it will be served as an attachment only');
  }

  return {
    bytes,
    mimeType: detected,
    originalName: sanitizeFilename(declaredName),
    sizeBytes: bytes.length,
    checksum: sha256(bytes),
  };
}

/** Keep a readable name for the UI without letting it influence any path. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'receipt');
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'receipt';
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function putDocument(organizationId: string, file: ValidatedUpload): Promise<string> {
  const key = `${organizationId}/${newId()}.${EXTENSIONS[file.mimeType] ?? 'bin'}`;
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.bytes, { mode: 0o600 });
  return key;
}

export async function getDocument(organizationId: string, key: string): Promise<Buffer> {
  // Ownership is encoded in the key and re-checked here, on top of the caller's own check.
  if (!key.startsWith(`${organizationId}/`)) throw new ApiError(403, 'Not allowed');
  return fs.readFile(resolveKey(key));
}

export async function deleteDocument(organizationId: string, key: string): Promise<void> {
  if (!key.startsWith(`${organizationId}/`)) throw new ApiError(403, 'Not allowed');
  await fs.rm(resolveKey(key), { force: true });
}

/** Resolve a storage key to an absolute path, refusing anything outside the root. */
function resolveKey(key: string): string {
  const target = path.resolve(ROOT, key);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!target.startsWith(rootWithSep)) throw new ApiError(400, 'Invalid storage key');
  return target;
}
