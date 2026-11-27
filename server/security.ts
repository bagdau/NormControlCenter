import crypto from 'node:crypto';
import path from 'node:path';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function validateUploadedFile(
  originalName: string,
  buffer: Buffer
): { ok: true; ext: '.pdf' | '.docx'; mimeType: string } | { ok: false; error: string } {
  if (!buffer || buffer.length === 0) {
    return { ok: false, error: 'Файл пуст (0 байт).' };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'Размер файла превышает лимит 25 МБ.' };
  }

  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      return {
        ok: false,
        error: 'Сигнатура файла не соответствует формату PDF (%PDF-).',
      };
    }
    return { ok: true, ext: '.pdf', mimeType: 'application/pdf' };
  }

  if (ext === '.docx') {
    // DOCX is a ZIP container starting with PK\x03\x04
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      return {
        ok: false,
        error: 'Сигнатура файла не соответствует формату DOCX (OOXML ZIP).',
      };
    }
    return {
      ok: true,
      ext: '.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  return {
    ok: false,
    error: 'Разрешены только файлы формата .PDF и .DOCX.',
  };
}

export function safeStoragePath(baseDir: string, storageKey: string): string {
  const cleanKey = storageKey.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!cleanKey || cleanKey !== storageKey) {
    throw new Error('Invalid storage key');
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanKey);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal rejected');
  }
  return resolvedTarget;
}
