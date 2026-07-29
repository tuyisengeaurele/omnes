import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const unlockSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type UnlockFormValues = z.infer<typeof unlockSchema>;

export function LockScreen() {
  const { t } = useTranslation();
  const unlock = useAuthStore((state) => state.unlock);
  const error = useAuthStore((state) => state.error);
  const session = useAuthStore((state) => state.session);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnlockFormValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await unlock(values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('auth.lockedTitle')}</h1>
        {session && <p className={styles.subtitle}>{session.username}</p>}
        <label className={styles.field}>
          <span>{t('auth.password')}</span>
          <input type="password" autoFocus {...register('password')} />
          {errors.password && <span className={styles.fieldError}>{errors.password.message}</span>}
        </label>
        {error && <p className={styles.formError}>{t('auth.unlockError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.unlockButton')}
        </button>
      </form>
    </div>
  );
}
