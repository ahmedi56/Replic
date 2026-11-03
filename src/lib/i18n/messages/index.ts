import { en } from './en';
import { fr } from './fr';
import type { Locale } from '../config';

export type MessageKey = keyof typeof en;

/** English is the source. `fr` is typed against it, so a missing French string fails the type check. */
export const messages: Record<Locale, Record<MessageKey, string>> = { en, fr };
