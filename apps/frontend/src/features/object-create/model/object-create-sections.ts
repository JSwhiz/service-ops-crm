import type { FormDialogSection } from '@/shared/ui/overlays';

export const OBJECT_CREATE_SECTIONS: FormDialogSection[] = [
  { id: 'basic', label: 'Основное' },
  { id: 'contract', label: 'Договор' },
  { id: 'people', label: 'Ответственные и контакты' },
  { id: 'payment', label: 'Оплата и сезоны' },
  { id: 'staffing', label: 'Штат и графики' },
  { id: 'articles', label: 'Плановые статьи' },
  { id: 'instructions', label: 'Инструкции' },
];
