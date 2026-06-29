import fs from 'fs';
import path from 'path';
import { logger } from '../config/logger';

let cachedLogoBase64: string | null = null;

export function loadLogoBase64(logoPath: string): string | null {
  if (cachedLogoBase64) return cachedLogoBase64;

  try {
    const resolvedPath = path.resolve(logoPath);
    if (!fs.existsSync(resolvedPath)) {
      logger.warn('Logo file not found', { path: resolvedPath });
      return null;
    }
    const buffer = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).slice(1).toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    cachedLogoBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
    return cachedLogoBase64;
  } catch (err) {
    logger.error('Failed to load logo', { err });
    return null;
  }
}
