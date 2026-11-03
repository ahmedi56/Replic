import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale, makeT } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLocale());
  return {
    title: { default: 'Reclip: Receipts in. Reconciliation done.', template: '%s · Reclip' },
    description: t('meta.description'),
    applicationName: 'Reclip',
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1220' },
  ],
};

/**
 * Some security browser extensions (Bitdefender TrafficLight and similar) stamp
 * `bis_skin_checked` onto every element before React hydrates, which React reports as a
 * hydration mismatch. This strips that one attribute as it appears, until the page has
 * settled. It touches nothing else and does nothing when no such extension is installed.
 */
const STRIP_EXTENSION_ATTRS = `(function(){var a='bis_skin_checked';function s(r){if(r.querySelectorAll){var n=r.querySelectorAll('['+a+']');for(var i=0;i<n.length;i++)n[i].removeAttribute(a);}}
var o=new MutationObserver(function(m){for(var i=0;i<m.length;i++){var t=m[i].target;if(m[i].type==='attributes'){t.removeAttribute(a);}else{s(t);}}});
o.observe(document.documentElement,{attributes:true,attributeFilter:[a],subtree:true,childList:true});
s(document);setTimeout(function(){o.disconnect();},5000);})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = makeT(locale);
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRS }} />
      </head>
      {/* suppressHydrationWarning: extensions also add attributes to <body> itself. */}
      <body suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
        >
          {t('common.skip')}
        </a>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
