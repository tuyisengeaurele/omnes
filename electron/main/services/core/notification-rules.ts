export function hasLicenseExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

export function isLicenseExpiringSoon(expiresAt: string | null, thresholdDays: number): boolean {
  if (!expiresAt) {
    return false;
  }
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  if (msRemaining <= 0) {
    return false;
  }
  return msRemaining <= thresholdDays * 24 * 60 * 60 * 1000;
}
