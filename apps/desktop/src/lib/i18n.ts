import { type AppLanguageSetting, resolveLocale } from '@fillforge/schema';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

export const i18nResources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN }
};

/** Initialize (or re-point) renderer i18n at the persisted language setting. */
export function applyLanguage(language: AppLanguageSetting): void {
  const lng = resolveLocale(language, navigator.language);
  document.documentElement.lang = lng;
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: i18nResources,
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false }
    });
  } else if (i18n.resolvedLanguage !== lng) {
    void i18n.changeLanguage(lng);
  }
}

export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(i18n.resolvedLanguage ?? 'en');
}
