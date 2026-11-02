import { LegalPage } from '@/components/legal-page';
import { legalConfig } from '@/lib/legal';
import { dpaSections } from '@/lib/legal-dpa';

export const metadata = { title: 'Data Processing Addendum' };
export const dynamic = 'force-dynamic';

export default function DataProcessingAddendumPage() {
  const config = legalConfig();
  return (
    <LegalPage
      title="Data Processing Addendum"
      intro="This addendum applies when Reclip handles personal data on your behalf, for example the names and transaction details in the receipts and bank rows you upload. It sets out what we do, and do not do, with that data."
      sections={dpaSections(config)}
      config={config}
    />
  );
}
