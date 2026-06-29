import { Router } from 'express';
import { env } from '../../config/env';
import { loadLogoBase64 } from '../../utils/logo';

export const router = Router();

router.get('/public/logo', (_req, res) => {
  const logo = loadLogoBase64(env.logoPath);
  if (!logo) {
    res.status(404).json({ success: false, message: 'Logo not available' });
    return;
  }
  res.json({ success: true, data: { logo } });
});
