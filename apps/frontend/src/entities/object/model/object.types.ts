export interface ObjectAssignedUser {
  userId: string;
  fullName: string;
  roleCode: string;
}

/**
 * Временный alias совместимости.
 * Базовый и долгоживущий тип в проекте — ObjectAssignedUser.
 * ObjectAssignmentPerson оставляем только для мягкого перехода старых компонентов.
 */
export type ObjectAssignmentPerson = ObjectAssignedUser;

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
}

export interface ServiceObject {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
  seasonMode: string;
  dailyRate: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  managers: ObjectAssignedUser[];
  responsibles: ObjectAssignedUser[];
}
