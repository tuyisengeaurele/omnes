import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const createAdminSchema = z
  .object({
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type CreateAdminFormValues = z.infer<typeof createAdminSchema>;

export function CreateFirstAdminScreen() {
  const { t } = useTranslation();
  const createFirstAdmin = useAuthStore((state) => state.createFirstAdmin);
  const error = useAuthStore((state) => state.error);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAdminFormValues>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { username: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createFirstAdmin(values.username, values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('auth.createAdminTitle')}</h1>
        <label className={styles.field}>
          <span>{t('auth.username')}</span>
          <input type="text" autoFocus {...register('username')} />
          {errors.username && <span className={styles.fieldError}>{errors.username.message}</span>}
        </label>
        <label className={styles.field}>
          <span>{t('auth.password')}</span>
          <input type="password" {...register('password')} />
          {errors.password && <span className={styles.fieldError}>{errors.password.message}</span>}
        </label>
        <label className={styles.field}>
          <span>{t('auth.confirmPassword')}</span>
          <input type="password" {...register('confirmPassword')} />
          {errors.confirmPassword && (
            <span className={styles.fieldError}>{errors.confirmPassword.message}</span>
          )}
        </label>
        {error && <p className={styles.formError}>{t('auth.createAdminError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.createAdminButton')}
        </button>
      </form>
    </div>
  );
}
