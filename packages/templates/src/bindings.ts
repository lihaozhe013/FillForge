import type { TemplateBinding } from '@fillforge/schema';

export type BindingTransform = (value: unknown) => unknown;

const DIGITS = '零壹贰叁肆伍陆柒捌玖';
const DIGIT_UNITS = ['', '拾', '佰', '仟'] as const;
const GROUP_UNITS = ['', '万', '亿'] as const;

function groupToChinese(n: number): string {
  const digits = [...String(n).padStart(4, '0')].map((d) => Number(d));
  let out = '';
  let pendingZero = false;
  for (let i = 0; i < 4; i++) {
    const digit = digits[i];
    const unit = DIGIT_UNITS[3 - i];
    if (digit === undefined || unit === undefined || digit === 0) {
      pendingZero = true;
      continue;
    }
    if (pendingZero && out) {
      out += '零';
    }
    out += DIGITS[digit] + unit;
    pendingZero = false;
  }
  return out;
}

function integerPartToChinese(yuan: number): string {
  if (yuan === 0) {
    return '零';
  }
  const groups: number[] = [];
  let remaining = yuan;
  while (remaining > 0) {
    groups.push(remaining % 10000);
    remaining = Math.floor(remaining / 10000);
  }
  let out = '';
  let pendingZero = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const groupValue = groups[i] ?? 0;
    if (groupValue === 0) {
      pendingZero = true;
      continue;
    }
    if (pendingZero && out) {
      out += '零';
    }
    const groupUnit = GROUP_UNITS[i] ?? '';
    out += groupToChinese(groupValue) + groupUnit;
    pendingZero = false;
  }
  return out;
}

/**
 * Render a monetary amount as formal Chinese currency words, e.g.
 * 1234.5 -> 壹仟贰佰叁拾肆元伍角整. Amounts are rounded to two decimals;
 * zero-yuan fractions omit the 零元 prefix (0.05 -> 伍分).
 */
export function chineseCurrencyUppercase(value: unknown): string {
  let amount: number;
  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    amount = Number(value);
  } else {
    return '';
  }
  if (!Number.isFinite(amount)) {
    return '';
  }
  const negative = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents / 10) % 10;
  const fen = cents % 10;

  let out = negative ? '负' : '';
  if (yuan > 0 || (jiao === 0 && fen === 0)) {
    out += `${integerPartToChinese(yuan)}元`;
  }
  if (jiao > 0) {
    out += `${DIGITS[jiao]}角`;
  }
  if (fen > 0) {
    if (jiao === 0 && yuan > 0) {
      out += '零';
    }
    out += `${DIGITS[fen]}分`;
  }
  if (fen === 0) {
    out += '整';
  }
  return out;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function toDateParts(value: unknown): DateParts | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: String(value.getUTCFullYear()).padStart(4, '0'),
      month: String(value.getUTCMonth() + 1).padStart(2, '0'),
      day: String(value.getUTCDate()).padStart(2, '0')
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toDateParts(new Date(value));
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (match?.[1] && match[2] && match[3]) {
      return { year: match[1], month: match[2], day: match[3] };
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toDateParts(parsed);
    }
  }
  return null;
}

export const builtinTransforms: Record<string, BindingTransform> = {
  identity: (value) => value,
  date_year: (value) => toDateParts(value)?.year ?? '',
  date_month: (value) => toDateParts(value)?.month ?? '',
  date_day: (value) => toDateParts(value)?.day ?? '',
  trim: (value) => (typeof value === 'string' ? value.trim() : value),
  uppercase: (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  lowercase: (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  chinese_currency_uppercase: chineseCurrencyUppercase
};

export function getBindingTransform(name: string): BindingTransform | undefined {
  return builtinTransforms[name];
}

export function applyBinding(value: unknown, binding: TemplateBinding): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const transform = binding.transform ? getBindingTransform(binding.transform) : undefined;
  return transform ? transform(value) : value;
}

/**
 * Resolve placeholder values from a normalized business record. Binding keys
 * are DOCX placeholders; `source` refers to a business field.
 */
export function resolveBindings(
  record: Record<string, unknown>,
  bindings: Record<string, TemplateBinding>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [placeholder, binding] of Object.entries(bindings)) {
    if (!Object.hasOwn(record, binding.source)) {
      continue;
    }
    output[placeholder] = applyBinding(record[binding.source], binding);
  }
  return output;
}
