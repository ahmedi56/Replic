'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { messages, type MessageKey } from './messages';
import { DEFAULT_LOCALE, interpolate, type Locale, type Params } from './config';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useMemo(
    () => (key: MessageKey, params?: Params) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, params),
    [locale],
  );
}
