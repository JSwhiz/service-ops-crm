'use client';

import React from 'react';
import type { PayContour } from '@/entities/object/model/object-scheduling.types';
import { Alert, Field, LoadingState } from '@/shared/ui/foundation';
import { Select } from '@/shared/ui/searchable-select/select';

export function HolidayContourPicker({ contours, loading, readError, value, onChange, disabled, error }: {
  contours: PayContour[]; loading: boolean; readError: string | null; value: string | null | undefined;
  onChange: (value: string | null) => void; disabled: boolean; error?: string | null;
}): React.JSX.Element {
  if (loading) return <LoadingState label="Загрузка условий оплаты праздника" />;
  if (readError) return <Alert tone="danger">{readError} Закройте форму и обновите сведения.</Alert>;
  return <Field label="Условие оплаты праздника" required error={error} description="Изменится только выбранное начисление. Для дневного и ночного условий исключения задаются отдельно.">
    <Select name="contourId" value={value === undefined ? '' : value ?? 'default'} disabled={disabled} onChange={(event) => onChange(event.target.value === 'default' ? null : event.target.value)}>
      <option value="">Выберите условие</option>
      <option value="default">Без отдельного условия · базовая оплата</option>
      {contours.map((contour) => <option key={contour.id} value={contour.id}>{contour.name}{contour.isActive ? '' : ' · Неактивно'}</option>)}
    </Select>
  </Field>;
}
