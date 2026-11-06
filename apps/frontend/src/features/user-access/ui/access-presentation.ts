import { ApiError } from '@/shared/api/fetcher';
import type { AccessRule, EffectiveAccess } from '@/entities/user-access/model/user-access.types';

export const scopeLabels = { own: 'Собственные', assigned: 'Назначенные', selected: 'Выбранные', all: 'Все' };
const labels: Record<string, string> = {
  deny: 'Персональный запрет, запрет раздела или неактивная учётная запись',
  legacy_policy: 'Действующие правила роли и контекст записи',
  legacy_permission: 'Ролевое или прежнее персональное разрешение',
  legacy_capability: 'Действующее серверное право',
  legacy_role: 'Системная роль',
  legacy_assignment: 'Действующее назначение',
  legacy_ownership: 'Принадлежность записи пользователю',
  legacy_active_user: 'Активная учётная запись',
  system_invariant: 'Обязательное системное правило',
  personal_allow_scoped: 'Персональное разрешение в ограниченной области',
  personal_deny_scoped: 'Персональный запрет в ограниченной области',
  founder_role: 'Роль учредителя с учётом персональных правил',
  personal_allow: 'Персональное разрешение', personal_deny: 'Персональный запрет',
  founder_only: 'Действие доступно только учредителю.',
  leadership_only: 'Сохраняется ограничение руководящим кругом.',
  director_only: 'Сохраняется ограничение ролью директора.',
  policy_decision_required: 'Изменение требует согласования продуктового правила. Персональное управление недоступно.',
  unsupported_standalone_operation: 'Отдельная операция не реализована; персональное управление недоступно.',
  logout_always_available: 'Выход из системы всегда доступен.',
  legacy_negative: 'Прежний персональный запрет; снимается отдельным согласованным процессом.',
  requires_legacy_policy_and_resource_context: 'Результат зависит от действующих правил и конкретной записи. Это не означает запрет.',
  ineffective_child_allow_parent_or_legacy_deny: 'Разрешение не действует из-за запрета раздела или прежнего персонального запрета.',
  parent_scope_deny_applies_where_scopes_overlap: 'В пересекающихся областях действует запрет родительского раздела.',
  active_user: 'Требуется активная учётная запись.',
  resource_visibility: 'Сохраняется проверка видимости конкретной записи.',
  domain_lifecycle: 'Сохраняются ограничения статуса и жизненного цикла записи.',
  independent_approval_where_required: 'Обязательное независимое согласование сохраняется.',
  immutable_posted_history: 'Проведённая история не переписывается.',
  historical_period_rules: 'Ограничения закрытых и исторических периодов сохраняются.',
  nonnegative_stock: 'Отрицательный остаток запрещён.', price_snapshot: 'Историческая стоимость сохраняется.',
  idempotency: 'Повтор запроса не должен создавать повторную операцию.', evidence_requirements: 'Требования к подтверждающим материалам сохраняются.',
  authorized_parent_entity: 'Доступ к файлу требует доступа к родительской записи.',
  current_membership: 'Проверяется действующее участие в комнате.', message_visibility_boundary: 'Границы видимости сообщений сохраняются.',
  author_and_edit_window: 'Сохраняются ограничения автора и времени редактирования.',
  current_recipient: 'Проверяется получатель уведомления.', current_source_visibility: 'Проверяется текущий доступ к источнику уведомления.',
  active_manager_assignment: 'Требуется действующее назначение менеджером объекта.',
  active_one_time_manager_assignment: 'Требуется действующее назначение менеджером заказа.',
  writable_target: 'Целевая запись должна допускать изменения.', open_order: 'Заказ должен быть открыт.',
  stock_evidence_and_idempotency: 'Проверяются остаток, подтверждающие материалы и защита от повторной операции.',
  employee_lifecycle_and_dependency_rules: 'Сохраняются статус сотрудника и ограничения связанных записей.',
  atomic_employee_creation: 'Сотрудник создаётся вместе со связью с кандидатом, без дублирования.',
  own_active_assignment_or_management_feedback: 'Нужно своё действующее назначение либо право управленческой обратной связи.',
  does_not_close_colleague_sla: 'Обратная связь не закрывает срок ответа другого менеджера.',
  child_object_visibility: 'Проверяется доступ к связанным объектам.', both_entity_scopes: 'Нужен доступ к обеим связанным записям.',
  source_order_visible: 'Исходный заказ должен быть доступен.', order_scope: 'Проверяется область доступа к заказу.',
  action_lifecycle: 'Действие зависит от текущего состояния записи.',
  compensating_ledger_operation: 'Исправление проводится отдельной компенсирующей операцией.',
  order_visible: 'Заказ должен быть доступен.', payment_lifecycle: 'Сохраняется жизненный цикл платежа.',
  structural_edit_only: 'Право касается состава и текста, а не исполнения.', history_snapshots: 'Исторические снимки сохраняются.',
  available_order: 'Заказ должен быть доступен.', current_team: 'Выбор ограничен действующей командой.', nonempty_list: 'Список не может быть пустым.',
  configured_manager_and_availability_lifecycle_where_required: 'Проверяются настройка менеджера календаря и статус доступности.',
  object_visibility: 'Объект должен быть доступен.', lifecycle: 'Сохраняются ограничения статуса записи.',
  object_delegation_where_supported: 'Объектное замещение применяется только к поддерживаемым действиям.',
  last_responsible_preserved: 'Нельзя снять последнего ответственного.',
  responsible_assignment_required_for_nonleadership: 'Вне руководящего круга требуется назначение ответственным.',
  resource_scope: 'Проверяется область доступа к конкретной записи.',
  separate_money_or_approval_constraint_where_required: 'Отдельные денежные права и согласования сохраняются.',
  basic_profile_projection_only: 'Доступен только базовый профиль объекта.',
  reports_only_no_other_object_operations: 'Разрешены только отчёты; остальные операции объекта не открываются.',
  employee_scope_and_object_visibility: 'Проверяются доступ к сотруднику и видимость объекта.',
  existing_active_condition_of_same_object: 'Можно выбрать только готовое активное условие этого объекта.',
  visible_object: 'Объект должен быть доступен.', historical_rows_preserved: 'Исторические строки сохраняются.',
  past_date_requires_other_leadership_approval: 'Прошлое исправление подтверждает другой пользователь руководящего круга.',
  period_open: 'Период должен быть открыт.', reason_required: 'Требуется причина изменения.',
  independent_approval: 'Требуется независимое согласование.', period_and_lifecycle_rules: 'Сохраняются ограничения периода и статуса.',
  source_and_comment: 'Нужны источник и комментарий.', no_order_receipt_duplication: 'Приход заказа не должен дублироваться.',
  account_and_document_lifecycle: 'Проверяются состояние счёта и документа.',
  exact_approval_type_resolver: 'Право решения зависит от конкретного типа согласования.',
  own_requests_union_resolvable_types: 'Доступны свои заявки и разрешённые типы согласований.', source_visibility: 'Источник должен быть доступен.',
  cancellable_type: 'Тип заявки должен допускать отмену.', pending_request: 'Заявка должна ожидать решения.',
  foreign_free_busy_only: 'Для коллег доступна только занятость без личных причин.', target_user: 'Проверяется целевой пользователь.',
  involved_principal_or_replacement: 'Проверяется участие исходного или замещающего пользователя.',
  explicit_objects: 'Область ограничена явно выбранными объектами.', time_bounded: 'Доступ ограничен сроком замещения.',
  writable_object: 'Объект должен допускать изменения.', migration_ready: 'Требуется готовность данных после перехода.',
  visible_target: 'Целевая запись должна быть доступна.', eligible_assignee: 'Исполнитель должен допускать назначение.',
  target_visibility: 'Проверяется доступ к цели задачи.', current_room_access: 'Комната должна быть доступна.',
  current_group_access: 'Нужен доступ к текущему групповому чату.', system_room_restrictions: 'Ограничения системных комнат сохраняются.',
  group_only: 'Действие доступно только для группового чата.', room_visibility: 'Проверяется видимость комнаты.',
  author_and_edit_window_where_required: 'Сохраняются ограничения автора и срока редактирования.',
  source_and_destination_forward_visibility: 'При пересылке проверяются исходная и целевая комнаты.',
  dismiss_only_read: 'Скрывать можно только прочитанное уведомление.',
  every_result_domain_scope_and_field_policy: 'Каждый результат поиска проверяется по области и видимости полей.',
  credentials_and_session_lifecycle: 'Сохраняются проверки входа и жизненного цикла сессии.',
};
export function accessLabel(code: string): string { return labels[code] ?? 'Дополнительное серверное ограничение; подробности в технических сведениях.'; }
export function effectiveLabel(row?: EffectiveAccess): string {
  if (!row) return 'Результат не получен';
  if (row.allowed === null) return 'Зависит от записи и действующих правил';
  if (row.source === 'personal_deny_scoped') return row.allowed ? 'Доступ сохраняется с персональным запретом в указанной области' : 'Запрещено в указанной области';
  if (row.allowed && row.scope && row.scope !== 'all') return 'Разрешено в указанной области';
  return row.allowed ? 'Разрешено' : 'Запрещено';
}
export function ruleLabel(rule?: AccessRule | null): string {
  if (!rule) return 'По умолчанию';
  return `${rule.effect === 'allow' ? 'Разрешить' : 'Запретить'} · ${scopeLabels[rule.scope]}${rule.scope === 'selected' ? ` (${rule.selectedIds.length})` : ''}`;
}
export function accessError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 409) return 'Версия, источники доступа или результат проверки изменились. Обновите данные для сравнения, затем повторите просмотр изменений. Ваши изменения сохранены в форме.';
    if (error.statusCode === 403) return 'Операция запрещена. Проверьте права учредителя и защиту последнего администратора.';
    if (error.statusCode === 404) return 'Пользователь или запись недоступны. Обновите список.';
    if (error.statusCode === 400 || error.statusCode === 422) return 'Сервер отклонил изменения. Проверьте причину, поддерживаемые области и выбранные записи.';
    if (error.statusCode === 401) return 'Сеанс завершён. Войдите в систему заново.';
  }
  return 'Не удалось выполнить запрос. Проверьте подключение и повторите действие.';
}
