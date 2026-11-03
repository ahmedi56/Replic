/** Languages the app speaks. Kept free of server-only code so the browser can import it. */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'reclip_lang';

export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', fr: 'Français' };

/** Region used for number and date formatting. French users in Tunisia get "47,850 DT". */
export const FORMAT_LOCALE: Record<Locale, string> = { en: 'en-GB', fr: 'fr-TN' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Pick a supported language from an Accept-Language header, or fall back to the default. */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.toLowerCase().split('-')[0], q: q ? Number.parseFloat(q) : 1 };
    })
    .filter((x) => x.lang && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);
  for (const { lang } of wanted) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}

export type Params = Record<string, string | number>;

/** Replace {name} placeholders. Unknown placeholders are left visible so a typo shows up in review. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? String(params[key]) : whole));
}
