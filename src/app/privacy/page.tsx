import { LegalPage } from '@/components/legal-page';
import { legalConfig } from '@/lib/legal';
import { privacySections } from '@/lib/legal-content';

export const metadata = { title: 'Privacy Policy' };
// Read the company details at request time, so they come from the running environment.
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  const config = legalConfig();
  return (
    <LegalPage
      title="Privacy Policy"
      intro="Reclip handles receipts, invoices and bank data. This policy says plainly what we collect, why, who else sees it, how long we keep it, and how you can take it back."
      sections={privacySections(config)}
      config={config}
    />
  );
}
