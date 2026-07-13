/**
 * Domain logic for short code generation and URL validation.
 * Pure module: no I/O, no framework, no side effects besides the injected RNG.
 */

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 6;
const MAX_COLLISION_ATTEMPTS = 3;

/** Returns a random integer in [0, maxExclusive). Injectable for deterministic tests. */
export type RandomIntFn = (maxExclusive: number) => number;

export function defaultRandomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

export class CollisionError extends Error {
  constructor(attempts: number = MAX_COLLISION_ATTEMPTS) {
    super(`Could not generate a unique code after ${attempts} attempts`);
    this.name = 'CollisionError';
  }
}

export class InvalidUrlError extends Error {
  constructor(url: string) {
    super(`Invalid URL: ${url}`);
    this.name = 'InvalidUrlError';
  }
}

/** Generates a 6 character base62 code using the provided (or default) RNG. */
export function generateCode(randomInt: RandomIntFn = defaultRandomInt): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = randomInt(BASE62_ALPHABET.length);
    code += BASE62_ALPHABET[index];
  }
  return code;
}

/** Only http/https URLs are accepted, anything else (including malformed strings) is rejected. */
export function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Generates a code that does not collide according to `codeExists`.
 * Retries up to MAX_COLLISION_ATTEMPTS times, then throws CollisionError.
 */
export function generateUniqueCode(
  codeExists: (code: string) => boolean,
  randomInt: RandomIntFn = defaultRandomInt
): string {
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const code = generateCode(randomInt);
    if (!codeExists(code)) {
      return code;
    }
  }
  throw new CollisionError(MAX_COLLISION_ATTEMPTS);
}
