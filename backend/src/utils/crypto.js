import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith('scrypt$')) return false;
  const [, salt, digest] = storedHash.split('$');
  if (!salt || !digest) return false;

  const derivedKey = await scrypt(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  const actual = Buffer.from(derivedKey);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function signJwt(payload, secret, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(body));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyJwt(token, secret) {
  const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Token inválido.');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Assinatura do token inválida.');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw new Error('Token expirado.');
  }

  return payload;
}

function deriveSymmetricKey(secret) {
  return createHash('sha256').update(String(secret)).digest();
}

export function encryptSensitiveValue(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveSymmetricKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSensitiveValue(payload, secret) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = String(payload || '').split('.');
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error('Payload criptografado invalido.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveSymmetricKey(secret),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
