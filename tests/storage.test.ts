import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createLocalBackend, createS3Backend } from '@/lib/storage';

/** An in-memory stand-in for an S3 bucket: just enough of the protocol the backend uses. */
function fakeS3(pageSize = 2) {
  const objects = new Map<string, { body: Buffer; contentType?: string; sse?: string }>();
  const log: string[] = [];
  let failDeletes = false;

  const client = {
    async send(command: unknown): Promise<any> {
      if (command instanceof PutObjectCommand) {
        const i = command.input;
        objects.set(i.Key!, { body: Buffer.from(i.Body as Buffer), contentType: i.ContentType, sse: i.ServerSideEncryption });
        log.push(`put ${i.Key}`);
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const found = objects.get(command.input.Key!);
        if (!found) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
        return { Body: { transformToByteArray: async () => new Uint8Array(found.body) } };
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key!);
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        // Like real S3, the continuation token is a position in key order, not an index, so
        // deleting earlier pages while paging does not skip anything.
        const after = command.input.ContinuationToken ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(command.input.Prefix ?? '') && k > after).sort();
        const page = keys.slice(0, pageSize);
        const more = keys.length > pageSize;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? page[page.length - 1] : undefined };
      }
      if (command instanceof DeleteObjectsCommand) {
        const targets = command.input.Delete!.Objects!.map((o) => o.Key!);
        if (failDeletes) return { Errors: targets.map((Key) => ({ Key, Code: 'AccessDenied' })) };
        for (const key of targets) objects.delete(key);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  return { client, objects, log, failDeletes: (v: boolean) => (failDeletes = v) };
}

describe('S3 storage backend', () => {
  it('stores, reads back and deletes a document', async () => {
    const s3 = fakeS3();
    const backend = createS3Backend(s3.client, { bucket: 'b' });
    await backend.put('org_1/a.pdf', Buffer.from('hello'), 'application/pdf');
    expect(s3.objects.get('org_1/a.pdf')?.contentType).toBe('application/pdf');
    expect((await backend.get('org_1/a.pdf')).toString()).toBe('hello');
    await backend.remove('org_1/a.pdf');
    expect(s3.objects.size).toBe(0);
  });

  it('asks for server-side encryption when configured', async () => {
    const s3 = fakeS3();
    await createS3Backend(s3.client, { bucket: 'b', serverSideEncryption: 'AES256' }).put('org_1/a.pdf', Buffer.from('x'), 'application/pdf');
    expect(s3.objects.get('org_1/a.pdf')?.sse).toBe('AES256');
  });

  it('deletes every object under a prefix across several pages, and nothing outside it', async () => {
    const s3 = fakeS3(2);
    const backend = createS3Backend(s3.client, { bucket: 'b' });
    for (let i = 0; i < 5; i++) await backend.put(`org_1/${i}.pdf`, Buffer.from('x'), 'application/pdf');
    await backend.put('org_2/keep.pdf', Buffer.from('x'), 'application/pdf');
    await backend.put('org_10/keep.pdf', Buffer.from('x'), 'application/pdf'); // shares the text "org_1", not the prefix "org_1/"

    await backend.removePrefix('org_1/');
    expect([...s3.objects.keys()].sort()).toEqual(['org_10/keep.pdf', 'org_2/keep.pdf']);
  });

  it('reports a partial delete failure instead of pretending it worked', async () => {
    const s3 = fakeS3();
    const backend = createS3Backend(s3.client, { bucket: 'b' });
    await backend.put('org_1/a.pdf', Buffer.from('x'), 'application/pdf');
    s3.failDeletes(true);
    await expect(backend.removePrefix('org_1/')).rejects.toThrow(/could not delete/i);
  });

  it('fails a read of a missing document', async () => {
    await expect(createS3Backend(fakeS3().client, { bucket: 'b' }).get('org_1/missing.pdf')).rejects.toThrow();
  });
});

describe('local storage backend', () => {
  it('round-trips, removes a prefix, and refuses keys that escape the root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reclip-store-'));
    try {
      const backend = createLocalBackend(root);
      await backend.put('org_1/a.pdf', Buffer.from('hello'), 'application/pdf');
      expect((await backend.get('org_1/a.pdf')).toString()).toBe('hello');
      await expect(backend.get('../outside.txt')).rejects.toThrow();
      await expect(backend.put('../../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow();
      await backend.removePrefix('org_1/');
      expect(fs.existsSync(path.join(root, 'org_1'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
