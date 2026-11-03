import type { TimesheetOverviewEntry } from '@/entities/timesheet/model/timesheet.types';
import type { ApiError } from '@/shared/api/fetcher';

export function describeTimesheetValue(entry: Pick<TimesheetOverviewEntry, 'finalValue' | 'hasFact' | 'isChangedManually' | 'manualValue'>): string {
  if (entry.isChangedManually && entry.manualValue === 0) return 'Ручная корректировка: 0 ₽. Прочерк в таблице означает нулевое начисление.';
  if (entry.isChangedManually) return 'Сохранена ручная корректировка начисления.';
  if (entry.finalValue === 0) return 'Начисление равно 0 ₽. Прочерк в таблице означает нулевую сумму, а факт выхода показан отдельно.';
  return 'Показано сохранённое итоговое начисление.';
}

/** Validate the existing correction contract; viewing a cell never creates a mutation. */
export function validateCellCorrection(value: string, reason: string, autoValue: number, canDirectEdit: boolean, allowApprovedRestore = false): string | null {
  const parsed = Number(value);
  if (!value.trim() || !Number.isInteger(parsed) || parsed < 0) return 'Введите целую сумму не меньше 0 ₽.';
  if (parsed !== autoValue && !reason.trim()) return 'Для ручной корректировки укажите причину.';
  if (allowApprovedRestore && !reason.trim()) return 'Для согласования возврата к авторасчёту укажите причину.';
  if (allowApprovedRestore) return null;
  if (!canDirectEdit && parsed === autoValue) return 'Возврат к авторасчёту доступен только пользователю с правом прямой корректировки.';
  return null;
}

export function humanizeCellCorrectionError(error: Pick<ApiError, 'statusCode' | 'code' | 'message'> | null): { message: string; recovery: 'edit' | 'refresh' | 'pending' } {
  // Legacy timesheet exceptions have no code. Match only known server messages;
  // never render their text or arbitrary framework validation diagnostics.
  if (error?.statusCode === 409 && /^Timesheet manual exception approval is already pending for this day$/i.test(error.message)) {
    return { message: 'По этому дню уже есть запрос на согласование. Дождитесь решения; повторный запрос не нужен. Проверьте историю корректировок.', recovery: 'pending' };
  }
  if (error?.statusCode === 401) return { message: 'Сеанс завершён. Войдите в систему и обновите табель перед корректировкой.', recovery: 'refresh' };
  if (error?.statusCode === 403) return { message: 'Недостаточно прав для этой корректировки. Обновите табель, чтобы проверить доступные действия.', recovery: 'refresh' };
  if (error?.statusCode === 409 || error?.code === 'TIMESHEET_REFRESH_REQUIRED') {
    return { message: 'Данные ячейки изменились или ещё обновляются. Обновите табель и сравните новое начисление с введённым значением перед сохранением.', recovery: 'refresh' };
  }
  if (error?.statusCode === 404) return { message: 'Строка сотрудника или выбранный день больше недоступны. Обновите табель перед корректировкой.', recovery: 'refresh' };
  if (error?.statusCode === 400 && /^Manual timesheet correction requires a comment$/i.test(error.message)) {
    return { message: 'Укажите причину отклонения от автоматического значения. Введённая сумма сохранена.', recovery: 'edit' };
  }
  if (error?.statusCode === 400 && /^(Manual exception must differ from current automatic value|Direct manual correction is available for current user)$/i.test(error.message)) {
    return { message: 'Автоматическое значение или доступный способ корректировки изменились. Обновите табель и проверьте сумму и права.', recovery: 'refresh' };
  }
  if (error?.statusCode === 400 || error?.statusCode === 422) return { message: 'Проверьте целую сумму не меньше 0 ₽, выбранный день и причину корректировки. Введённые значения сохранены.', recovery: 'edit' };
  return { message: 'Результат сохранения не подтверждён. Введённые значения сохранены. Обновите табель и проверьте результат перед повторной отправкой.', recovery: 'refresh' };
}

export function isCellCorrectionRetryBlocked(pendingRequest: boolean, blockedAtRevision: number | null, dataRevision: number): boolean {
  return pendingRequest || (blockedAtRevision !== null && dataRevision <= blockedAtRevision);
}
