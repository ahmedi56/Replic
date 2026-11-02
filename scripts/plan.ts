/**
 * Manage customer plans after a bank transfer arrives.
 *
 *   npm run plan -- list
 *   npm run plan -- show <email>
 *   npm run plan -- expiring [--days 30]
 *   npm run plan -- set <email> <plan> --until YYYY-MM-DD [--ref INV-2026-001] [--quota 1000] [--dry-run]
 *
 * Plans: free, pro, business. A paid plan always needs an end date; after it passes, the account
 * falls back to the Free limits (nothing is deleted). Uses the same DATABASE_URL as the app. The
 * embedded development database belongs to one process, so stop `npm run dev` first.
 */
import { closeDb } from '@/db';
import { PRICING_PLANS } from '@/lib/pricing';
import { expiringPlans, findPlanByEmail, listPlans, setPlan, type PlanRow } from '@/lib/services/plans';

const [command, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const positional = rest.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && rest[i - 1] !== '--dry-run'));

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '-');

function status(r: Pick<PlanRow, 'plan' | 'currentPeriodEnd' | 'expired' | 'daysLeft'>): string {
  if (r.plan === 'free') return 'free';
  if (r.expired) return `EXPIRED ${day(r.currentPeriodEnd)} (on Free limits)`;
  return `active until ${day(r.currentPeriodEnd)} (${r.daysLeft} days left)`;
}

function printTable(table: PlanRow[]): void {
  if (!table.length) return void console.log('Nothing to show.');
  for (const r of table) {
    console.log(`${r.email.padEnd(34)} ${r.plan.padEnd(9)} ${String(r.receiptQuota).padStart(5)}/mo  ${status(r)}${r.paymentReference ? `  ref ${r.paymentReference}` : ''}`);
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'list':
      printTable(await listPlans());
      return;

    case 'show': {
      const email = positional[0];
      if (!email) throw new Error('Usage: npm run plan -- show <email>');
      const found = await findPlanByEmail(email);
      if (!found.length) throw new Error(`No account with the email ${email}.`);
      printTable(found);
      return;
    }

    case 'expiring': {
      const days = Number(flag('days') ?? 30);
      if (!Number.isFinite(days) || days < 0) throw new Error('--days must be a number.');
      console.log(`Paid plans ending within ${days} days (or already ended):`);
      printTable(await expiringPlans(days));
      return;
    }

    case 'set': {
      const [email, plan] = positional;
      if (!email || !plan) {
        throw new Error(`Usage: npm run plan -- set <email> <${PRICING_PLANS.map((p) => p.id).join('|')}> --until YYYY-MM-DD [--ref INV-001] [--quota N] [--dry-run]`);
      }
      const quota = flag('quota');
      const result = await setPlan({
        email,
        plan,
        until: flag('until'),
        quota: quota === undefined ? undefined : Number(quota),
        reference: flag('ref'),
        dryRun: rest.includes('--dry-run'),
      });
      console.log(`${result.applied ? 'Updated' : 'DRY RUN (nothing changed)'}: ${result.email} (${result.organizationName})`);
      console.log(`  before: ${result.before.plan}, ${result.before.receiptQuota}/mo, ends ${day(result.before.currentPeriodEnd)}`);
      console.log(`  after:  ${result.after.plan}, ${result.after.receiptQuota}/mo, ends ${day(result.after.currentPeriodEnd)}${result.after.paymentReference ? `, ref ${result.after.paymentReference}` : ''}`);
      return;
    }

    default:
      throw new Error('Usage: npm run plan -- list | show <email> | expiring [--days N] | set <email> <plan> --until YYYY-MM-DD');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
