import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { addUserFormSchema, type AddUserFormValues } from './AddUserForm.schema';
import styles from './AddUserForm.module.css';

interface AddUserFormProps {
  onSaved: () => void;
  onCancel: () => void;
}

export function AddUserForm({ onSaved, onCancel }: AddUserFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserFormSchema),
    defaultValues: { username: '', password: '', role: 'CASHIER' },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await window.omnes?.createUser(values.username, values.password, values.role);
    if (result?.success) {
      onSaved();
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h2 className={styles.title}>{t('users.addUser')}</h2>
      <label className={styles.field}>
        <span>{t('users.username')}</span>
        <input type="text" autoFocus {...register('username')} />
        {errors.username && <span className={styles.fieldError}>{errors.username.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('users.password')}</span>
        <input type="password" {...register('password')} />
        {errors.password && <span className={styles.fieldError}>{errors.password.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('users.role')}</span>
        <select {...register('role')}>
          <option value="ADMIN">{t('users.roleAdmin')}</option>
          <option value="MANAGER">{t('users.roleManager')}</option>
          <option value="CASHIER">{t('users.roleCashier')}</option>
        </select>
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          {t('users.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting}>
          {t('users.addUser')}
        </button>
      </div>
    </form>
  );
}
