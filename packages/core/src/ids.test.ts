import { describe, expect, it } from 'vitest';
import { generateUlid, isValidUlid, slugifyId, ulidTimestamp } from './ids.ts';

describe('generateUlid', () => {
  it('produces 26-character canonical ULIDs', () => {
    const id = generateUlid();
    expect(id).toHaveLength(26);
    expect(isValidUlid(id)).toBe(true);
  });

  it('is monotonic within the same millisecond', () => {
    const now = 1_789_000_000_000;
    const ids = Array.from({ length: 1000 }, () => generateUlid(now));
    const unique = new Set(ids);
    expect(unique.size).toBe(1000);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('encodes the given timestamp', () => {
    const now = 1_789_000_000_123;
    expect(ulidTimestamp(generateUlid(now))).toBe(now);
  });

  it('generates ids that sort by creation time', () => {
    const first = generateUlid(1_000_000_000_000);
    const second = generateUlid(2_000_000_000_000);
    expect(first < second).toBe(true);
  });
});

describe('slugifyId', () => {
  it('converts human names into machine-friendly ids', () => {
    expect(slugifyId('Invoice CN')).toBe('invoice-cn');
    expect(slugifyId('  NDA -- Template v2  ')).toBe('nda-template-v2');
  });

  it('falls back to a generated id when nothing survives', () => {
    const id = slugifyId('中文模板');
    expect(id).toMatch(/^template-[a-z0-9]{6}$/);
  });
});
