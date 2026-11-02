import { LegalPage } from '@/components/legal-page';
import { legalConfig } from '@/lib/legal';
import { termsSections } from '@/lib/legal-content';

export const metadata = { title: 'Terms of Service' };
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  const config = legalConfig();
  return (
    <LegalPage
      title="Terms of Service"
      intro="These are the rules for using Reclip: what the service does and does not do, how paid plans work, and what each of us is responsible for."
      sections={termsSections(config)}
      config={config}
    />
  );
}
