import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const HASH_PREFIX = 'scrypt';
const SALT_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES).toString('hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH_BYTES)) as Buffer;

  return `${HASH_PREFIX}$${salt}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [prefix, salt, expectedHash] = storedHash.split('$');

  if (!prefix || !salt || !expectedHash || prefix !== HASH_PREFIX) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const derivedKey = (await scrypt(
    password,
    salt,
    expectedBuffer.length,
  )) as Buffer;

  if (expectedBuffer.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, derivedKey);
}
