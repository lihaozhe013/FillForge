import { type AppLanguageSetting, resolveLocale } from '@fillforge/schema';
import { app } from 'electron';
import i18n from 'i18next';
import en from '../src/locales/en.json';
import zhCN from '../src/locales/zh-CN.json';

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN }
};

export function applyLanguage(language: AppLanguageSetting): void {
  const lng = resolveLocale(language, app.getLocale());
  if (!i18n.isInitialized) {
    void i18n.init({
      resources,
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false }
    });
  } else if (i18n.resolvedLanguage !== lng) {
    void i18n.changeLanguage(lng);
  }
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options) as string;
}
