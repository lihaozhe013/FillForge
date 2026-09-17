import { describe, expect, it } from 'vitest';
import {
  applyBinding,
  builtinTransforms,
  chineseCurrencyUppercase,
  resolveBindings
} from './bindings.ts';

describe('builtin transforms', () => {
  it('provides the documented initial set', () => {
    expect(Object.keys(builtinTransforms).sort()).toEqual([
      'chinese_currency_uppercase',
      'date_day',
      'date_month',
      'date_year',
      'identity',
      'lowercase',
      'trim',
      'uppercase'
    ]);
  });

  it('splits ISO dates into parts', () => {
    expect(builtinTransforms.date_year?.('2026-09-16')).toBe('2026');
    expect(builtinTransforms.date_month?.('2026-09-16')).toBe('09');
    expect(builtinTransforms.date_day?.('2026-09-16')).toBe('16');
    expect(builtinTransforms.date_year?.(null)).toBe('');
  });

  it('changes string case and trims', () => {
    expect(builtinTransforms.uppercase?.('abc')).toBe('ABC');
    expect(builtinTransforms.lowercase?.('ABC')).toBe('abc');
    expect(builtinTransforms.trim?.('  value  ')).toBe('value');
    expect(builtinTransforms.uppercase?.(42)).toBe(42);
  });

  it('leaves nullish values untouched through applyBinding', () => {
    expect(applyBinding(null, { source: 'x', transform: 'trim' })).toBeNull();
    expect(applyBinding(undefined, { source: 'x', transform: 'trim' })).toBeUndefined();
  });
});

describe('chineseCurrencyUppercase', () => {
  it.each([
    [0, '零元整'],
    [1234.5, '壹仟贰佰叁拾肆元伍角整'],
    [1234, '壹仟贰佰叁拾肆元整'],
    [12345678.9, '壹仟贰佰叁拾肆万伍仟陆佰柒拾捌元玖角整'],
    [100000001, '壹亿零壹元整'],
    [100.05, '壹佰元零伍分'],
    [12001.06, '壹万贰仟零壹元零陆分'],
    [-1.25, '负壹元贰角伍分'],
    ['1234.50', '壹仟贰佰叁拾肆元伍角整'],
    [null, ''],
    ['abc', ''],
    [Number.NaN, '']
  ])('converts %p to %s', (input, expected) => {
    expect(chineseCurrencyUppercase(input)).toBe(expected);
  });
});

describe('resolveBindings', () => {
  it('implements the invoice date decomposition from the spec', () => {
    const values = resolveBindings(
      { invoice_date: '2026-09-16', total_amount: 1234.5 },
      {
        invoice_year: { source: 'invoice_date', transform: 'date_year' },
        invoice_month: { source: 'invoice_date', transform: 'date_month' },
        invoice_day: { source: 'invoice_date', transform: 'date_day' },
        amount_uppercase: {
          source: 'total_amount',
          transform: 'chinese_currency_uppercase'
        },
        invoice_date: { source: 'invoice_date' }
      }
    );
    expect(values).toEqual({
      invoice_year: '2026',
      invoice_month: '09',
      invoice_day: '16',
      amount_uppercase: '壹仟贰佰叁拾肆元伍角整',
      invoice_date: '2026-09-16'
    });
  });

  it('skips bindings whose source field is missing', () => {
    const values = resolveBindings({}, { title: { source: 'title' } });
    expect(values).toEqual({});
  });

  it('keeps unknown transforms as identity', () => {
    const values = resolveBindings(
      { name: 'abc' },
      { name: { source: 'name', transform: 'nonexistent' } }
    );
    expect(values).toEqual({ name: 'abc' });
  });
});
