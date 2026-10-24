/**
 * Backups from the command line.
 *
 *   npm run backup -- key                 print a new random encryption key
 *   npm run backup -- create              make a backup now
 *   npm run backup -- list                list stored backups
 *   npm run backup -- restore <name|file> restore into an EMPTY database
 *
 * Uses the same DATABASE_URL, storage settings and BACKUP_ENCRYPTION_KEY as the app. The
 * embedded development database belongs to one process, so stop `npm run dev` first.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { closeDb } from '@/db';
import { createBackup, listBackups, restoreBackup, restoreBackupByName } from '@/lib/backup';

const [command, argument] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case 'key':
      console.log(crypto.randomBytes(32).toString('hex'));
      console.error('Keep this safe, and apart from the backups: without it they cannot be opened.');
      return;

    case 'create': {
      const result = await createBackup();
      console.log(`Backup written: ${result.key} (${Math.round(result.bytes / 1024)} KB)`);
      for (const [table, count] of Object.entries(result.rows)) console.log(`  ${table.padEnd(20)} ${count}`);
      return;
    }

    case 'list': {
      const names = await listBackups();
      console.log(names.length ? names.join('\n') : 'No backups yet.');
      return;
    }

    case 'restore': {
      if (!argument) throw new Error('Say which backup: npm run backup -- restore <name from `list`, or a path to a downloaded .rcbk file>');
      const result = fs.existsSync(argument) ? await restoreBackup(fs.readFileSync(argument)) : await restoreBackupByName(argument);
      console.log(`Restored the backup taken ${result.createdAt}:`);
      for (const [table, count] of Object.entries(result.rows)) console.log(`  ${table.padEnd(20)} ${count}`);
      console.log('Uploaded documents are not part of a backup; they are in your storage bucket.');
      return;
    }

    default:
      throw new Error('Usage: npm run backup -- key | create | list | restore <name|file>');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
