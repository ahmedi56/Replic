import { messages, type MessageKey } from './messages';
import { interpolate, type Locale, type Params } from './config';

export type Translate = (key: MessageKey, params?: Params) => string;

/** A translator for one language. Pure: no cookies, no request, safe in emails and scripts. */
export function makeT(locale: Locale): Translate {
  return (key, params) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, params);
}
