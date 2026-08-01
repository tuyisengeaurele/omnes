import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import { productFormSchema, type ProductFormValues } from './ProductForm.schema';
import styles from './ProductForm.module.css';

interface ProductFormProps {
  product?: Product;
  onSaved: () => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSaved, onCancel }: ProductFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      barcode: product?.barcode ?? '',
      category: product?.category ?? '',
      price: product?.price ?? 0,
      stockQuantity: product?.stockQuantity ?? 0,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      sku: values.sku,
      barcode: values.barcode || null,
      category: values.category,
      price: values.price,
      stockQuantity: values.stockQuantity,
    };

    const result = product
      ? await window.omnes?.updateProduct(product.id, input)
      : await window.omnes?.createProduct(input);

    if (result?.success) {
      onSaved();
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h2 className={styles.title}>
        {product ? t('inventory.editProduct') : t('inventory.addProduct')}
      </h2>
      <label className={styles.field}>
        <span>{t('inventory.name')}</span>
        <input type="text" autoFocus {...register('name')} />
        {errors.name && <span className={styles.fieldError}>{errors.name.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.sku')}</span>
        <input type="text" {...register('sku')} />
        {errors.sku && <span className={styles.fieldError}>{errors.sku.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.barcode')}</span>
        <input type="text" {...register('barcode')} />
      </label>
      <label className={styles.field}>
        <span>{t('inventory.category')}</span>
        <input type="text" {...register('category')} />
        {errors.category && <span className={styles.fieldError}>{errors.category.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.price')}</span>
        <input type="number" min={0} step={1} {...register('price', { valueAsNumber: true })} />
        {errors.price && <span className={styles.fieldError}>{errors.price.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.stockQuantity')}</span>
        <input
          type="number"
          min={0}
          step={1}
          {...register('stockQuantity', { valueAsNumber: true })}
        />
        {errors.stockQuantity && (
          <span className={styles.fieldError}>{errors.stockQuantity.message}</span>
        )}
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          {t('inventory.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting}>
          {product ? t('inventory.saveChanges') : t('inventory.addProduct')}
        </button>
      </div>
    </form>
  );
}
