import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const error = useAuthStore((state) => state.error);
  const lastUsername = useAuthStore((state) => state.lastUsername);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: lastUsername ?? '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.username, values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('app.name')}</h1>
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
        {error && <p className={styles.formError}>{t('auth.loginError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.loginButton')}
        </button>
      </form>
    </div>
  );
}
