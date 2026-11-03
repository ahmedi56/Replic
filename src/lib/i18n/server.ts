import 'server-only';
import { cookies, headers } from 'next/headers';
import { messages, type MessageKey } from './messages';
import { DEFAULT_LOCALE, LOCALE_COOKIE, interpolate, isLocale, negotiateLocale, type Locale, type Params } from './config';

export type Translate = (key: MessageKey, params?: Params) => string;

/** The visitor's language: their saved choice first, then their browser's, then English. */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return negotiateLocale((await headers()).get('accept-language')) ?? DEFAULT_LOCALE;
}

export function makeT(locale: Locale): Translate {
  return (key, params) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, params);
}

export async function getT(): Promise<Translate> {
  return makeT(await getLocale());
}
