import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Customer } from '@shared/ipc';
import { customerFormSchema, type CustomerFormValues } from './CustomerForm.schema';
import styles from './CustomerForm.module.css';

interface CustomerFormProps {
  customer?: Customer;
  onSaved: () => void;
  onCancel: () => void;
}

export function CustomerForm({ customer, onSaved, onCancel }: CustomerFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      notes: customer?.notes ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      phone: values.phone || null,
      email: values.email || null,
      notes: values.notes || null,
    };

    const result = customer
      ? await window.omnes?.updateCustomer(customer.id, input)
      : await window.omnes?.createCustomer(input);

    if (result?.success) {
      onSaved();
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h2 className={styles.title}>{customer ? t('crm.editCustomer') : t('crm.addCustomer')}</h2>
      <label className={styles.field}>
        <span>{t('crm.name')}</span>
        <input type="text" autoFocus {...register('name')} />
        {errors.name && <span className={styles.fieldError}>{errors.name.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('crm.phone')}</span>
        <input type="text" {...register('phone')} />
      </label>
      <label className={styles.field}>
        <span>{t('crm.email')}</span>
        <input type="text" {...register('email')} />
      </label>
      <label className={styles.field}>
        <span>{t('crm.notes')}</span>
        <input type="text" {...register('notes')} />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          {t('crm.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting}>
          {customer ? t('crm.saveChanges') : t('crm.addCustomer')}
        </button>
      </div>
    </form>
  );
}
