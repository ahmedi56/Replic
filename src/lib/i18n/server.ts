import 'server-only';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from './config';
import { makeT, type Translate } from './translate';

export { makeT, type Translate };

/** The visitor's language: their saved choice first, then their browser's, then English. */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return negotiateLocale((await headers()).get('accept-language')) ?? DEFAULT_LOCALE;
}

export async function getT(): Promise<Translate> {
  return makeT(await getLocale());
}
