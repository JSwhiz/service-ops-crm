export const MEDIA_CATEGORY_OPTIONS = [
  { value: 'before', label: 'До' },
  { value: 'after', label: 'После' },
  { value: 'report', label: 'Отчет' },
  { value: 'comment', label: 'Комментарий' },
  { value: 'other', label: 'Другое' },
] as const;

export function getMediaCategoryLabel(category: string): string {
  return (
    MEDIA_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ??
    category
  );
}
