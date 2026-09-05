import type { AuthUser } from '@/shared/auth/auth-client';

export type CommandGroup =
  | 'Недавние'
  | 'Объекты'
  | 'Разовые заказы'
  | 'Задачи'
  | 'Сотрудники'
  | 'Кандидаты'
  | 'Действия'
  | 'Навигация';

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  href: string;
  keywords?: string;
  kind: 'entity' | 'action' | 'navigation';
}

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'Недавние',
  'Объекты',
  'Задачи',
  'Разовые заказы',
  'Сотрудники',
  'Кандидаты',
  'Действия',
  'Навигация',
];

export function resolveGlobalNavigation(user: AuthUser | null): CommandItem[] {
  const capabilities = user?.capabilities;

  return [
    { id: 'nav-dashboard', group: 'Навигация', label: 'Рабочий стол', href: '/dashboard', kind: 'navigation', keywords: 'главная dashboard workspace' },
    ...(capabilities?.canAccessApprovals ? [{ id: 'nav-approvals', group: 'Навигация' as const, label: 'Согласования', href: '/approvals', kind: 'navigation' as const }] : []),
    { id: 'nav-objects', group: 'Навигация', label: 'Объекты', href: '/objects', kind: 'navigation', keywords: 'объект адрес' },
    ...(capabilities?.canAccessOneTimeOrders || capabilities?.canViewAllOneTimeOrderReviews ? [{ id: 'nav-orders', group: 'Навигация' as const, label: 'Разовые заказы', href: '/one-time-orders', kind: 'navigation' as const, keywords: 'заказ разовый' }] : []),
    ...(capabilities?.canAccessAccountability ? [{ id: 'nav-accountability', group: 'Навигация' as const, label: 'Подотчет', href: '/accountability', kind: 'navigation' as const }] : []),
    ...(capabilities?.canAccessInventory ? [{ id: 'nav-inventory', group: 'Навигация' as const, label: 'Расходники', href: '/inventory', kind: 'navigation' as const }] : []),
    ...(capabilities?.canAccessEquipment ? [{ id: 'nav-equipment', group: 'Навигация' as const, label: 'Оборудование', href: '/equipment', kind: 'navigation' as const }] : []),
    { id: 'nav-tasks', group: 'Навигация', label: 'Задачи', href: '/tasks', kind: 'navigation', keywords: 'задача поручение' },
    { id: 'nav-timesheet', group: 'Навигация', label: 'Табель', href: '/timesheet', kind: 'navigation', keywords: 'табель выплаты зарплата аванс' },
    ...(capabilities?.canAccessCandidates ? [{ id: 'nav-candidates', group: 'Навигация' as const, label: 'Кандидаты', href: '/candidates', kind: 'navigation' as const }] : []),
    ...(capabilities?.canAccessEmployeesHr ? [{ id: 'nav-employees', group: 'Навигация' as const, label: 'Сотрудники', href: '/employees', kind: 'navigation' as const, keywords: 'работники персонал hr' }] : []),
    ...(capabilities?.canAccessChats ? [{ id: 'nav-chats', group: 'Навигация' as const, label: 'Чаты', href: '/chats', kind: 'navigation' as const }] : []),
    { id: 'nav-settings', group: 'Навигация', label: 'Настройки', href: '/settings', kind: 'navigation' },
  ];
}

export function resolveGlobalActions(user: AuthUser | null): CommandItem[] {
  const capabilities = user?.capabilities;

  return [
    { id: 'action-task-new', group: 'Действия', label: 'Создать задачу', description: 'Новая задача', href: '/tasks/new', kind: 'action', keywords: 'добавить новая задача' },
    ...(capabilities?.canCreateObject ? [{ id: 'action-object-new', group: 'Действия' as const, label: 'Создать объект', description: 'Новый объект', href: '/objects/new', kind: 'action' as const }] : []),
    ...(capabilities?.canCreateOneTimeOrder ? [{ id: 'action-order-new', group: 'Действия' as const, label: 'Создать разовый заказ', description: 'Новый разовый заказ', href: '/one-time-orders/new', kind: 'action' as const }] : []),
    ...(capabilities?.canCreateEmployee ? [{ id: 'action-employee-new', group: 'Действия' as const, label: 'Создать сотрудника', description: 'Новый сотрудник', href: '/employees/new', kind: 'action' as const, keywords: 'добавить сотрудник работник' }] : []),
    ...(capabilities?.canManageCandidates ? [{ id: 'action-candidate-new', group: 'Действия' as const, label: 'Создать кандидата', description: 'Новый кандидат', href: '/candidates/new', kind: 'action' as const, keywords: 'добавить кандидат найм' }] : []),
  ];
}
