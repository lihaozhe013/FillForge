import path from 'node:path';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BITS = BigInt(RANDOM_LENGTH * 5);

let lastTime = -1;
let lastRandom = 0n;

function encodeTime(time: number): string {
  let remaining = time;
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ENCODING[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function encodeRandom(random: bigint): string {
  let remaining = random;
  let out = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    out = ENCODING[Number(remaining & 31n)] + out;
    remaining >>= 5n;
  }
  return out;
}

function randomBigint(): bigint {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Generate a sortable ULID. Ids created within the same millisecond are
 * monotonic, so lexicographic order matches creation order.
 */
export function generateUlid(now: number = Date.now()): string {
  // ULID timestamps are 48 bits; clamp instead of silently overflowing.
  const time = Math.min(Math.max(Math.trunc(now), 0), 0xffffffffffff);
  let random: bigint;
  if (time === lastTime) {
    random = (lastRandom + 1n) & ((1n << RANDOM_BITS) - 1n);
  } else {
    random = randomBigint();
  }
  lastTime = time;
  lastRandom = random;
  return encodeTime(time) + encodeRandom(random);
}

export function isValidUlid(value: string): boolean {
  return /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/.test(value);
}

export function ulidTimestamp(id: string): number {
  let time = 0;
  for (const char of id.slice(0, TIME_LENGTH)) {
    const index = ENCODING.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    time = time * 32 + index;
  }
  return time;
}

export function randomSuffix(length = 6): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

export function slugifyId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `template-${randomSuffix()}`;
}

export function pathBasename(filePath: string): string {
  return path.basename(filePath);
}
