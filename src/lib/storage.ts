import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
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
 * The interface is deliberately small (put/get/delete), so the filesystem and S3 are
 * interchangeable without touching callers. Choose with S3_BUCKET (see .env.example).
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

/**
 * Where bytes actually live. Two implementations behind one small interface:
 * the local filesystem (development, or a single server with a persistent disk) and any
 * S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO), which is what lets more
 * than one app instance serve the same documents.
 */
export interface StorageBackend {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
  /** Keys under a prefix, in no particular order. */
  list(prefix: string): Promise<string[]>;
}

export function createLocalBackend(root: string): StorageBackend {
  const base = path.resolve(root);
  // Resolve a key to an absolute path, refusing anything outside the root.
  function resolveKey(key: string): string {
    const target = path.resolve(base, key);
    const rootWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (!target.startsWith(rootWithSep)) throw new ApiError(400, 'Invalid storage key');
    return target;
  }
  return {
    async put(key, bytes) {
      const target = resolveKey(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { mode: 0o600 });
    },
    async get(key) {
      return fs.readFile(resolveKey(key));
    },
    async remove(key) {
      await fs.rm(resolveKey(key), { force: true });
    },
    async removePrefix(prefix) {
      await fs.rm(resolveKey(prefix), { recursive: true, force: true });
    },
    async list(prefix) {
      const dir = resolveKey(prefix);
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      return entries.filter((e) => e.isFile()).map((e) => path.posix.join(prefix.replace(/\/+$/, ''), path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/')));
    },
  };
}

export function createS3Backend(
  client: Pick<S3Client, 'send'>,
  options: { bucket: string; serverSideEncryption?: ServerSideEncryption },
): StorageBackend {
  const { bucket } = options;
  return {
    async put(key, bytes, mimeType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: mimeType,
          ...(options.serverSideEncryption ? { ServerSideEncryption: options.serverSideEncryption } : {}),
        }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new ApiError(404, 'Document not found');
      return Buffer.from(await result.Body.transformToByteArray());
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async removePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length) {
          const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
          // A partial failure must not be reported as a completed deletion.
          if (result.Errors?.length) throw new Error(`Could not delete ${result.Errors.length} stored documents`);
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    async list(prefix) {
      const found: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) if (object.Key) found.push(object.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return found;
    },
  };
}

let backend: StorageBackend | null = null;

function getBackend(): StorageBackend {
  if (backend) return backend;
  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    backend = createS3Backend(
      new S3Client({
        region: process.env.S3_REGION || 'auto',
        // Needed for R2, B2, MinIO and other S3-compatible services; omit for AWS itself.
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        // Without explicit keys the SDK falls back to its normal chain (IAM role, env, profile).
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      }),
      { bucket, serverSideEncryption: (process.env.S3_SSE as ServerSideEncryption | undefined) || undefined },
    );
  } else {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[storage] S3_BUCKET is not set: documents are stored on local disk, which limits you to one instance.');
    }
    backend = createLocalBackend(ROOT);
  }
  return backend;
}

/** Replace the storage backend (tests only). */
export function setStorageBackend(next: StorageBackend | null): void {
  backend = next;
}

function assertOwnKey(organizationId: string, key: string): void {
  // Ownership is encoded in the key and re-checked here, on top of the caller's own check.
  if (!key.startsWith(`${organizationId}/`) || key.includes('..')) throw new ApiError(403, 'Not allowed');
}

export async function putDocument(organizationId: string, file: ValidatedUpload): Promise<string> {
  const key = `${organizationId}/${newId()}.${EXTENSIONS[file.mimeType] ?? 'bin'}`;
  await getBackend().put(key, file.bytes, file.mimeType);
  return key;
}

export async function getDocument(organizationId: string, key: string): Promise<Buffer> {
  assertOwnKey(organizationId, key);
  return getBackend().get(key);
}

export async function deleteDocument(organizationId: string, key: string): Promise<void> {
  assertOwnKey(organizationId, key);
  await getBackend().remove(key);
}

/** Remove every stored document for an organization (used when an account is deleted). */
export async function deleteOrganizationDocuments(organizationId: string): Promise<void> {
  if (!/^[\w-]+$/.test(organizationId)) throw new ApiError(400, 'Invalid organization id');
  await getBackend().removePrefix(`${organizationId}/`);
}

/**
 * Backups live in the same store as documents, under their own prefix. Organization ids all
 * start with "org_", so this prefix can never collide with, or be read through, a tenant's
 * document keys (`getDocument` insists on the caller's own organization prefix).
 */
export const BACKUP_PREFIX = 'backups/';

function assertBackupKey(key: string): void {
  if (!key.startsWith(BACKUP_PREFIX) || key.includes('..')) throw new ApiError(400, 'Not a backup key');
}

export async function putBackupObject(key: string, bytes: Buffer): Promise<void> {
  assertBackupKey(key);
  await getBackend().put(key, bytes, 'application/octet-stream');
}

export async function getBackupObject(key: string): Promise<Buffer> {
  assertBackupKey(key);
  return getBackend().get(key);
}

export async function listBackupObjects(): Promise<string[]> {
  return (await getBackend().list(BACKUP_PREFIX)).sort();
}

export async function deleteBackupObject(key: string): Promise<void> {
  assertBackupKey(key);
  await getBackend().remove(key);
}
