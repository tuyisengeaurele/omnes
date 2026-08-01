import { getActiveLicense } from './license-store';
import { hasLicenseExpired, isLicenseExpiringSoon } from './notification-rules';
import { notify } from './notifications';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_WARNING_THRESHOLD_DAYS = 14;
const LICENSE_EXPIRY_NOTIFICATION_ID = 'license-expiry';

function checkLicenseExpiry(): void {
  const { expiresAt } = getActiveLicense();

  if (hasLicenseExpired(expiresAt)) {
    notify({
      id: LICENSE_EXPIRY_NOTIFICATION_ID,
      severity: 'error',
      title: 'License expired',
      message: 'Your OMNES license has expired. Contact your administrator to renew it.',
    });
    return;
  }

  if (isLicenseExpiringSoon(expiresAt, EXPIRY_WARNING_THRESHOLD_DAYS)) {
    const daysRemaining = Math.ceil(
      (new Date(expiresAt as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    notify({
      id: LICENSE_EXPIRY_NOTIFICATION_ID,
      severity: 'warning',
      title: 'License expiring soon',
      message: `Your OMNES license expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
    });
  }
}

export function startNotificationScheduler(): NodeJS.Timeout {
  checkLicenseExpiry();
  return setInterval(checkLicenseExpiry, CHECK_INTERVAL_MS);
}
