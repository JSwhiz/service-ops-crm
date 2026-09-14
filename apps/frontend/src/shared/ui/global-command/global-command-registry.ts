import type { AuthUser } from '@/shared/auth/auth-client';

export type CommandGroup =
  | 'Недавние'
  | 'Объекты'
  | 'Разовые заказы'
  | 'Задачи'
  | 'Сотрудники'
  | 'Кандидаты'
  | 'Контрагенты'
  | 'Расходники'
  | 'Оборудование'
  | 'Действия'
  | 'Навигация';

export type CreateGroup = 'Основное' | 'Люди' | 'Справочники';

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  description?: string;
  href: string;
  keywords?: string;
  kind: 'entity' | 'action' | 'navigation';
  createGroup?: CreateGroup;
}

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'Недавние',
  'Объекты',
  'Задачи',
  'Разовые заказы',
  'Сотрудники',
  'Кандидаты',
  'Контрагенты',
  'Расходники',
  'Оборудование',
  'Действия',
  'Навигация',
];

export const CREATE_GROUP_ORDER: CreateGroup[] = [
  'Основное',
  'Люди',
  'Справочники',
];

export function resolveGlobalNavigation(user: AuthUser | null): CommandItem[] {
  const capabilities = user?.capabilities;

  return [
    { id: 'nav-dashboard', group: 'Навигация', label: 'Рабочий стол', href: '/dashboard', kind: 'navigation', keywords: 'главная dashboard workspace' },
    ...(capabilities?.canAccessApprovals ? [{ id: 'nav-approvals', group: 'Навигация' as const, label: 'Согласования', href: '/approvals', kind: 'navigation' as const }] : []),
    { id: 'nav-objects', group: 'Навигация', label: 'Объекты', href: '/objects', kind: 'navigation', keywords: 'объект адрес' },
    ...(capabilities?.canAccessCounterparties ? [{ id: 'nav-counterparties', group: 'Навигация' as const, label: 'Контрагенты', href: '/counterparties', kind: 'navigation' as const, keywords: 'клиенты заказчики юридические лица ук управляющая компания' }] : []),
    ...(capabilities?.canAccessOneTimeOrders || capabilities?.canViewAllOneTimeOrderReviews ? [{ id: 'nav-orders', group: 'Навигация' as const, label: 'Разовые заказы', href: '/one-time-orders', kind: 'navigation' as const, keywords: 'заказ разовый' }] : []),
    ...(capabilities?.canViewOneTimeOrderCalendar ? [{ id: 'nav-order-calendar', group: 'Навигация' as const, label: 'Календарь разовых заказов', href: '/one-time-orders/calendar', kind: 'navigation' as const, keywords: 'календарь менеджеры даты разовые заказы' }] : []),
    ...(capabilities?.canAccessAccountability ? [{ id: 'nav-accountability', group: 'Навигация' as const, label: 'Подотчет', href: '/accountability', kind: 'navigation' as const }] : []),
    ...(capabilities?.canAccessInventory ? [{ id: 'nav-inventory', group: 'Навигация' as const, label: 'Расходники', href: '/inventory', kind: 'navigation' as const, keywords: 'склад материалы позиции' }] : []),
    ...(capabilities?.canAccessEquipment ? [{ id: 'nav-equipment', group: 'Навигация' as const, label: 'Оборудование', href: '/equipment', kind: 'navigation' as const, keywords: 'инвентарь техника серийный номер' }] : []),
    { id: 'nav-tasks', group: 'Навигация', label: 'Задачи', href: '/tasks', kind: 'navigation', keywords: 'задача поручение' },
    { id: 'nav-timesheet', group: 'Навигация', label: 'Табель', href: '/timesheet', kind: 'navigation', keywords: 'табель выплаты зарплата аванс' },
    ...(capabilities?.canAccessCandidates ? [{ id: 'nav-candidates', group: 'Навигация' as const, label: 'Кандидаты', href: '/candidates', kind: 'navigation' as const }] : []),
    ...(capabilities?.canAccessEmployeesHr ? [{ id: 'nav-employees', group: 'Навигация' as const, label: 'Сотрудники', href: '/employees', kind: 'navigation' as const, keywords: 'работники персонал hr' }] : []),
    { id: 'nav-user-absences', group: 'Навигация', label: 'Отсутствия', href: '/user-absences', kind: 'navigation', keywords: 'отпуск больничный отгул отсутствия график' },
    ...(capabilities?.canAccessChats ? [{ id: 'nav-chats', group: 'Навигация' as const, label: 'Чаты', href: '/chats', kind: 'navigation' as const }] : []),
    { id: 'nav-settings', group: 'Навигация', label: 'Настройки', href: '/settings', kind: 'navigation' },
  ];
}

export function resolveGlobalActions(user: AuthUser | null): CommandItem[] {
  const capabilities = user?.capabilities;

  return [
    { id: 'action-task-new', group: 'Действия', label: 'Создать задачу', description: 'Новая задача', href: '/tasks/new', kind: 'action', keywords: 'добавить новая задача', createGroup: 'Основное' },
    ...(capabilities?.canCreateObject ? [{ id: 'action-object-new', group: 'Действия' as const, label: 'Создать объект', description: 'Новый объект', href: '/objects/new', kind: 'action' as const, createGroup: 'Основное' as const }] : []),
    ...(capabilities?.canCreateOneTimeOrder ? [{ id: 'action-order-new', group: 'Действия' as const, label: 'Создать разовый заказ', description: 'Новый разовый заказ', href: '/one-time-orders/new', kind: 'action' as const, createGroup: 'Основное' as const }] : []),
    ...(capabilities?.canCreateEmployee ? [{ id: 'action-employee-new', group: 'Действия' as const, label: 'Создать сотрудника', description: 'Новый сотрудник', href: '/employees/new', kind: 'action' as const, keywords: 'добавить сотрудник работник', createGroup: 'Люди' as const }] : []),
    ...(capabilities?.canManageCandidates ? [{ id: 'action-candidate-new', group: 'Действия' as const, label: 'Создать кандидата', description: 'Новый кандидат', href: '/candidates/new', kind: 'action' as const, keywords: 'добавить кандидат найм', createGroup: 'Люди' as const }] : []),
    ...(capabilities?.canManageCounterparties ? [{ id: 'action-counterparty-new', group: 'Действия' as const, label: 'Создать контрагента', description: 'Новый контрагент', href: '/counterparties/new', kind: 'action' as const, keywords: 'добавить клиент заказчик ук', createGroup: 'Справочники' as const }] : []),
    ...(capabilities?.canManageInventoryCatalog ? [{ id: 'action-inventory-new', group: 'Действия' as const, label: 'Создать позицию расходников', description: 'Новая складская позиция', href: '/inventory/new', kind: 'action' as const, keywords: 'добавить расходник материал склад', createGroup: 'Справочники' as const }] : []),
    ...(capabilities?.canManageEquipmentCatalog ? [{ id: 'action-equipment-new', group: 'Действия' as const, label: 'Добавить оборудование', description: 'Новая единица оборудования', href: '/equipment/new', kind: 'action' as const, keywords: 'создать оборудование техника инвентарь', createGroup: 'Справочники' as const }] : []),
  ];
}
