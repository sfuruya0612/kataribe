import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  translate,
  translateCount,
  type MessageKey,
  type MessageParams,
} from '../../shared/i18n';
import type { UiLanguage } from '../../shared/types';

export type I18nValue = {
  locale: UiLanguage;
  setLocale: (locale: UiLanguage) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  tc: (
    count: number,
    singularKey: MessageKey,
    pluralKey: MessageKey,
    params?: MessageParams,
  ) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * UI 言語とメッセージ関数を配下の画面へ提供する。
 */
export function I18nProvider({
  children,
  initialLocale = 'ja',
}: {
  children: ReactNode;
  initialLocale?: UiLanguage;
}) {
  const [locale, setLocale] = useState<UiLanguage>(initialLocale);
  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
  const tc = useCallback(
    (
      count: number,
      singularKey: MessageKey,
      pluralKey: MessageKey,
      params?: MessageParams,
    ) => translateCount(locale, count, singularKey, pluralKey, params),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, tc }),
    [locale, t, tc],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
