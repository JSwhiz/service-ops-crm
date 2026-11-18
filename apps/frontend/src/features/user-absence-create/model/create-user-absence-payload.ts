import type { UserAbsenceItem, UserAbsenceType, UserAbsenceUserOption } from '@/entities/user-absence/model/user-absence.types';

export interface UserAbsenceCreateValues {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string;
}

export function changeUserAbsenceCreateTarget(
  value: UserAbsenceCreateValues,
  userId: string,
): UserAbsenceCreateValues {
  return userId === value.userId ? value : { ...value, userId, comment: '' };
}

export function toCreateUserAbsencePayload(
  value: UserAbsenceCreateValues,
  target: UserAbsenceUserOption | undefined,
): {
  userId: string;
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment?: string | null;
} {
  if (!target || target.id !== value.userId || target.capabilities?.canCreate !== true) {
    throw new Error('Создание отсутствия для выбранного пользователя недоступно. Выберите пользователя с правом создания. Черновик сохранён.');
  }
  return {
    userId: value.userId,
    absenceType: value.absenceType,
    startDate: value.startDate,
    endDate: value.endDate,
    ...(target.capabilities.canViewPrivateReasons ? { comment: value.comment || null } : {}),
  };
}

export function toUpdateUserAbsencePayload(
  value: UserAbsenceCreateValues,
  item: UserAbsenceItem | undefined,
  commentChanged = false,
): {
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment?: string | null;
} {
  if (!item || item.userId !== value.userId || item.capabilities?.canUpdate !== true) {
    throw new Error('Изменение этой записи недоступно. Черновик сохранён. Обновите календарь для проверки доступа.');
  }
  return {
    absenceType: value.absenceType,
    startDate: value.startDate,
    endDate: value.endDate,
    ...(commentChanged && item.capabilities.canViewPrivateReasons ? { comment: value.comment || null } : {}),
  };
}
