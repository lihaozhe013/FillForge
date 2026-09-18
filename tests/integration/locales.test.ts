import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.resolve(import.meta.dirname, '../../apps/desktop/src/locales');

function flattenKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return flattenKeys(child as Record<string, unknown>, fullKey);
    }
    return [fullKey];
  });
}

function loadLocale(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, file), 'utf8')) as Record<string, unknown>;
}

describe('locale resource parity', () => {
  const en = loadLocale('en.json');
  const zh = loadLocale('zh-CN.json');

  it('defines the same key sets in every locale', () => {
    expect(flattenKeys(zh).sort()).toEqual(flattenKeys(en).sort());
  });

  it('covers every Help menu entry in both locales', () => {
    const menuKeys = flattenKeys(en)
      .filter((key) => key.startsWith('menu.'))
      .sort();
    for (const entry of [
      'menu.help',
      'menu.userGuide',
      'menu.aiAgentPrompt',
      'menu.projectSpecification',
      'menu.onGithub'
    ]) {
      expect(menuKeys).toContain(entry);
    }
    expect(flattenKeys(zh)).toEqual(expect.arrayContaining(menuKeys));
  });
});
