import {
  AccessActionDefinition,
  AccessScope,
} from "./types/access-policy.type";

const scoped: readonly AccessScope[] = ["own", "assigned", "selected", "all"];
const selected: readonly AccessScope[] = ["selected", "all"];
const global: readonly AccessScope[] = ["all"];
type Entry = readonly [string, string, string?];
const actions: AccessActionDefinition[] = [];
function group(
  module: string,
  title: string,
  resourceType: string,
  entries: readonly Entry[],
  scopes = scoped,
) {
  actions.push({
    code: `${module}.access`,
    name: title,
    description: `Доступ к разделу «${title}»`,
    module,
    resourceType,
    allowedScopes: scopes,
    manageable: true,
    legacyPermissionCodes: [],
    integrationStatus: "policy_contract",
  });
  for (const [suffix, name, legacy] of entries)
    actions.push({
      code: `${module}.${suffix}`,
      name,
      description: name,
      module,
      resourceType,
      allowedScopes: suffix === "create" ? global : scopes,
      parentAction: `${module}.access`,
      manageable: true,
      legacyPermissionCodes: legacy ? [legacy] : [],
      integrationStatus: "policy_contract",
    });
}
group(
  "dashboard",
  "Рабочий стол",
  "dashboard",
  [
    ["view", "Просмотр рабочего стола"],
    ["leadership.view", "Рабочий стол руководства"],
    ["manager.view", "Рабочий стол менеджера"],
    ["hr.view", "Рабочий стол HR"],
    ["operations.view", "Рабочий стол операционного менеджера"],
  ],
  global,
);
group("objects", "Объекты", "object", [
  ["read", "Просмотр объекта", "objects.read"],
  ["create", "Создание объекта", "objects.create"],
  ["update", "Изменение объекта", "objects.update"],
  ["status", "Изменение статуса"],
  ["freeze", "Заморозка объекта"],
  ["archive", "Архивирование объекта"],
  ["restore", "Восстановление объекта"],
  ["responsibles.manage", "Ответственные объекта"],
  ["managers.manage", "Менеджеры объекта"],
  ["history", "История объекта"],
  ["contacts.read", "Чтение контактов"],
  ["contacts.manage", "Изменение контактов"],
  ["materials.read", "Чтение материалов"],
  ["materials.manage", "Материалы и инструкции"],
  ["arrival.read", "Чтение фото прибытия"],
  ["arrival.create", "Фото прибытия"],
  ["reports.read", "Чтение отчётов"],
  ["reports.update", "Черновик отчёта"],
  ["reports.submit", "Отправка отчёта"],
  ["reports.attachments.correct", "Исправление вложений отчёта"],
  ["comments.read", "Чтение комментариев"],
  ["comments.create", "Комментарий объекта"],
  ["staffing.read", "Просмотр состава"],
  ["staffing.manage", "Изменение состава"],
  ["attendance.read", "Просмотр посещаемости"],
  ["attendance.edit", "Отметки посещаемости"],
  ["rates.read", "Просмотр ставок"],
  ["rates.manage", "Управление ставками", "object.daily_rate_edit"],
  ["budget.read", "Просмотр бюджета"],
  ["budget.edit", "Изменение бюджета", "object.budget_edit"],
  ["coefficient.edit", "Коэффициент", "object.coefficient_edit"],
  ["contract_amount.read", "Договорная сумма"],
  ["planning.manage", "Настройки планирования"],
  ["schedules.read", "Просмотр позиций и графика"],
  ["schedules.manage", "Позиции и группы графика"],
  ["pay_conditions.select", "Выбор готового условия оплаты"],
  ["compensation.read", "Расшифровка начислений"],
  ["compensation.manage", "Версии условий и фонд команды"],
  ["compensation.adjust", "Допработа и цена выхода"],
  ["compensation.correct_past", "Заявка на прошлое исправление"],
  ["inventory.read", "Расходники объекта"],
  ["inventory.issue", "Выдача расходников на объект"],
  ["equipment.read", "Оборудование объекта"],
  ["linked_orders.read", "Связанные заказы"],
  ["hr_reports_view", "HR-просмотр отчётов", "objects.hr_reports_view"],
  ["view_hr", "HR-профиль объекта", "objects.view_hr"],
]);
group("one_time_orders", "Разовые заказы", "one_time_order", [
  ["read", "Просмотр заказа"],
  ["create", "Создание заказа"],
  ["update", "Изменение заказа"],
  ["copy", "Копирование заказа"],
  ["status", "Статус заказа"],
  ["complete", "Завершение заказа"],
  ["reopen", "Повторное открытие"],
  ["managers.manage", "Менеджеры заказа"],
  ["finance.read", "Финансы заказа"],
  ["payments.create", "Регистрация оплаты"],
  ["payments.correct", "Исправление оплаты"],
  ["history", "История заказа"],
  ["review.edit", "Изменение отзыва", "one_time_order.review.edit"],
  ["review.delete", "Удаление отзыва"],
  ["review.view_all", "Все отзывы", "one_time_order.review.view_all"],
  ["comments.read", "Чтение комментариев"],
  ["comments.create", "Добавление комментария"],
  ["reports.read", "Просмотр отчёта"],
  ["reports.update", "Изменение отчёта"],
  ["photos.read", "Просмотр фото"],
  ["photos.create", "Добавление фото"],
  ["photos.delete", "Удаление фото"],
  ["photos.restore", "Восстановление фото"],
  ["specification.read", "Просмотр ТЗ"],
  ["specification.manage", "Состав и текст ТЗ"],
  ["specification.execute", "Выполнение пункта ТЗ"],
  ["specification.comments", "Комментарии пункта ТЗ"],
  ["specification.attachments", "Вложения пункта ТЗ"],
  ["specification.detach", "Отвязка вложения ТЗ"],
  ["employees.read", "Состав команды заказа"],
  ["employees.manage", "Изменение команды"],
  ["employees.payment.edit", "Договорные суммы сотрудника"],
  ["attendance.read", "Посещаемость заказа"],
  ["attendance.edit", "Отметки посещаемости заказа"],
  ["timesheet.read", "Табель заказа"],
  ["timesheet.export", "Выгрузка табеля заказа"],
  ["payouts.read", "Выплаты по заказу"],
  ["inventory.read", "Расходники заказа"],
  ["equipment.read", "Оборудование заказа"],
  ["escorts.manage", "Сопровождающие", "one_time_order.escorts.manage"],
]);
group("one_time_order_calendar", "Календарь разовых заказов", "user", [
  ["read", "Просмотр календаря заказов"],
  ["export", "Выгрузка календаря"],
  ["manage", "Управление календарём", "one_time_order.calendar.manage"],
  ["availability.own", "Своя доступность"],
  ["availability.manage", "Доступность менеджеров"],
  [
    "availability.approve",
    "Согласование доступности",
    "one_time_order.calendar.approve_availability",
  ],
]);
group(
  "specification_catalog",
  "Каталог ТЗ",
  "specification_catalog",
  [
    ["read", "Чтение каталога"],
    ["create", "Создание пункта или шаблона"],
    ["update", "Изменение пункта или шаблона"],
    ["archive", "Архивирование пункта или шаблона"],
  ],
  global,
);
group(
  "counterparties",
  "Контрагенты",
  "counterparty",
  [
    ["read", "Просмотр контрагента", "counterparties.view"],
    ["create", "Создание контрагента"],
    ["update", "Изменение контрагента", "counterparties.manage"],
    ["archive", "Архивирование"],
    ["restore", "Восстановление"],
    ["history", "История контрагента"],
    ["objects.link", "Связь с объектом", "counterparties.link_objects"],
    ["master_object.manage", "Мастер-объект"],
    ["inventory.read", "Агрегированная история расходников"],
  ],
  selected,
);
group(
  "inventory",
  "Склад",
  "inventory_item",
  [
    ["read", "Просмотр каталога"],
    ["catalog.create", "Создание номенклатуры"],
    ["catalog.update", "Изменение номенклатуры"],
    ["catalog.delete", "Удаление номенклатуры", "inventory.catalog.delete"],
    ["catalog.restore", "Восстановление номенклатуры"],
    ["movements.read", "История движений"],
    ["receipt", "Приход"],
    ["issue_to_object", "Выдача на объект"],
    ["issue_to_one_time_order", "Отгрузка в разовый заказ"],
    ["return", "Возврат"],
    ["writeoff", "Списание"],
    ["adjustment", "Корректировка остатка"],
    ["movement.correct", "Исправление выдачи"],
    ["reports", "Складские отчёты"],
    ["resolve_missing_photo", "Исключение без фото"],
    ["references.read", "Выбор складских целей"],
  ],
  selected,
);
group(
  "equipment",
  "Оборудование",
  "equipment_unit",
  [
    ["read", "Просмотр оборудования"],
    ["catalog.read", "Каталог оборудования"],
    ["catalog.create", "Создание модели"],
    ["catalog.delete", "Удаление модели"],
    ["unit.create", "Создание единицы"],
    ["unit.delete", "Удаление ошибочной единицы", "equipment.unit.delete"],
    ["history", "История оборудования"],
    ["assign_object", "Выдача на объект"],
    ["assign_order", "Выдача на заказ"],
    ["return", "Возврат"],
    ["move", "Перемещение"],
    ["broken", "Поломка"],
    ["repair", "В ремонт"],
    ["repair_return", "Из ремонта"],
    ["lost", "Утрата"],
    ["writeoff", "Списание"],
  ],
  selected,
);
group("mats", "Ковры", "object", [
  ["read", "Просмотр ковров"],
  ["catalog.read", "Каталог размеров"],
  ["catalog.create", "Создание размера"],
  ["cost.edit", "Стоимость замены"],
  ["quantity.edit", "Количество на объекте"],
  ["history", "История ковров"],
]);
group("tasks", "Задачи", "task", [
  ["read", "Просмотр задачи", "tasks.read"],
  ["create", "Создание задачи", "tasks.create"],
  ["update", "Изменение задачи", "tasks.update"],
  ["status", "Изменение статуса"],
  ["assignees.manage", "Исполнители"],
  ["result.submit", "Отправка результата"],
  ["completion.draft", "Черновик выполнения"],
  ["completion.submit", "Отметка выполнения"],
  ["completion.undo", "Отмена выполнения"],
  ["confirm", "Подтверждение результата"],
  ["complete_now", "Немедленное завершение"],
  ["return", "Возврат в работу"],
  ["reopen", "Повторное открытие"],
  ["cancel", "Отмена задачи"],
  ["history", "История задачи"],
]);
group("timesheet", "Табель объектов", "object", [
  ["read", "Просмотр табеля", "timesheet.read"],
  ["overview", "Сводный табель"],
  ["export", "Выгрузка табеля"],
  ["attendance.edit", "Посещаемость", "timesheet.attendance.edit"],
  ["amount.edit", "Корректировка суммы в табеле", "timesheet.amount.edit"],
  ["manual_correction", "Ручная корректировка", "timesheet.manual_correction"],
  ["exceptions.create", "Заявка на исключение"],
  ["corrections.read", "История исправлений"],
]);
group("accountability", "Подотчёт", "user", [
  ["read", "Просмотр счёта"],
  ["review", "Сверка счетов", "accountability.review"],
  ["issue_cash", "Выдача подотчётных средств", "accountability.issue_cash"],
  ["external_receipt", "Свободный приход на свой счёт"],
  ["correct_receipt", "Сторно прихода", "accountability.correct_receipt"],
  ["expenses.create", "Новый расход"],
  ["expenses.update", "Изменение черновика расхода"],
  ["expenses.submit", "Отправка расхода"],
  ["expenses.approve", "Подтверждение расхода", "expense.approve"],
  ["expenses.reject", "Отклонение расхода"],
  ["closure.request", "Отправка сверки"],
  ["closure.approve", "Подтверждение сверки", "accountability.closure.approve"],
  ["closure.reject", "Отклонение сверки"],
  ["order_summary.read", "Сводка заказа"],
]);
group("user_absences", "Календарь пользователей", "user", [
  ["read", "Просмотр своего календаря"],
  ["view_all", "Занятость коллег", "user_absences.view_all"],
  ["create", "Создание своего события"],
  ["update", "Изменение своего события"],
  ["delete", "Удаление своего события"],
  ["manage", "Редактирование календарей коллег", "user_absences.manage"],
  [
    "view_private_reasons",
    "Приватные причины",
    "user_absences.view_private_reasons",
  ],
]);
group("visit_plans", "Дневные планы", "user", [
  ["read", "Просмотр плана"],
  ["manage", "Формирование планов", "visit_plans.manage"],
  ["visits.manage", "Отметки посещений"],
  ["reports.manage", "Отчёт посещения"],
  ["history", "История плана"],
]);
group("user_substitutions", "Объектные замещения", "object", [
  ["read", "Просмотр замещений"],
  ["create", "Создание своего замещения"],
  ["manage", "Администрирование замещений", "objects.substitution.manage"],
  ["revoke", "Отзыв замещения"],
]);
group("candidates", "Кандидаты", "candidate", [
  ["view", "Просмотр кандидатов", "candidates.view"],
  ["manage", "Управление кандидатами", "candidates.manage"],
  ["create", "Создание кандидата"],
  ["update", "Редактирование кандидата"],
  ["status", "Смена статуса"],
  ["archive", "Архивирование"],
  ["restore", "Восстановление"],
  ["assignments.manage", "Ответственные менеджеры"],
  ["respond", "Ответ менеджера", "candidates.respond"],
  ["convert_employee", "Оформить сотрудником"],
]);
group(
  "employees",
  "Сотрудники",
  "employee",
  [
    ["view", "Просмотр сотрудника", "employees.view"],
    ["create", "Создание сотрудника", "employees.create"],
    ["edit", "Изменение сотрудника", "employees.edit"],
    ["archive", "Архивирование", "employees.archive"],
    ["restore", "Восстановление", "employees.restore"],
    [
      "delete_permanently",
      "Удаление ошибочной записи",
      "employees.delete_permanently",
    ],
    [
      "assignments.manage",
      "Назначения на объекты",
      "employees.assignments.manage",
    ],
    [
      "assignments.delete_as_error",
      "Ошибочное назначение",
      "employees.assignments.delete_error",
    ],
    ["availability.manage", "Недоступность сотрудника"],
    ["substitutions.manage", "Подмены сотрудника"],
    ["attendance.read", "Выходы сотрудника"],
    ["documents.edit", "Отметки документов"],
  ],
  selected,
);
group(
  "approvals",
  "Согласования",
  "approval",
  [
    ["read", "Просмотр согласований"],
    ["resolve_task_result", "Результат задачи", "approval.resolve_task_result"],
    [
      "resolve_object_change",
      "Изменение объекта",
      "approval.resolve_object_change",
    ],
    [
      "resolve_inventory_exception",
      "Исключение склада",
      "approval.resolve_inventory_exception",
    ],
    ["resolve_accountability", "Подотчёт"],
    ["resolve_timesheet", "Прошлые денежные исправления"],
    ["cancel", "Отмена своей заявки"],
  ],
  selected,
);
group("chat", "Чаты", "chat_room", [
  ["read", "Просмотр чатов"],
  ["search", "Поиск сообщений"],
  ["room.direct", "Личный чат"],
  ["room.group", "Групповой чат"],
  ["room.update", "Изменение комнаты"],
  ["room.manage_members", "Участники чата", "chat.room.manage_members"],
  ["room.hide", "Скрытие чата"],
  ["room.unhide", "Показ скрытого чата"],
  ["room.leave", "Выход из чата"],
  ["room.close_global", "Закрытие чата", "chat.room.close_global"],
  ["messages.read", "Чтение сообщений"],
  ["messages.create", "Отправка сообщения"],
  ["messages.edit", "Редактирование своего сообщения"],
  ["messages.delete", "Удаление сообщения"],
  ["messages.forward", "Пересылка"],
  ["messages.react", "Реакция"],
  ["read_receipts", "Прочтение"],
  ["realtime", "Realtime комнаты"],
]);
group(
  "notifications",
  "Уведомления",
  "notification",
  [
    ["read", "Просмотр уведомлений"],
    ["mark_read", "Отметка прочтения"],
    ["dismiss", "Скрытие прочитанного"],
    ["realtime", "Доставка уведомлений"],
  ],
  ["own", "all"],
);
group(
  "search",
  "Поиск",
  "search",
  [
    ["query", "Поиск"],
    ["recent", "Недавние результаты"],
  ],
  global,
);
group("files", "Файлы", "file", [
  ["read", "Чтение файла"],
  ["download", "Скачивание файла"],
  ["preview", "Превью"],
  ["preview.retry", "Повтор подготовки превью"],
  ["upload", "Загрузка файла"],
  ["detach", "Отвязка файла"],
]);
group(
  "auth",
  "Учётная запись",
  "user",
  [
    ["login", "Вход", "auth.login"],
    ["me", "Свой профиль"],
    ["refresh", "Обновление сессии"],
    ["logout", "Выход"],
  ],
  ["own", "all"],
);
group("settings", "Настройки", "settings", [], global);
group(
  "users_access",
  "Пользователи и доступы",
  "user",
  [["manage", "Управление доступами"]],
  global,
);

const unsupportedStandaloneActions: Readonly<Record<string, string>> = {
  "objects.planning.manage":
    "Самостоятельного права планирования нет: бюджет проверяется действием «Изменение бюджета», сезоны — действием «Управление ставками». Этот переключатель не применяется.",
  "one_time_order_calendar.manage":
    "Самостоятельного управления календарём нет: используйте действие «Доступность менеджеров». Прежнее разрешение управления календарём сохраняется источником действующего доступа, а не новым персональным правилом.",
  "timesheet.attendance.edit":
    "Отдельного изменения посещаемости через табель нет: действуют «Отметки посещаемости» объекта и «Посещаемость заказа». Этот переключатель не применяется.",
  "equipment.move":
    "Перемещение выполняется действиями выдачи и возврата оборудования с проверкой исходного и целевого места. Самостоятельной операции перемещения нет.",
  "tasks.status":
    "Прежний общий запрос статуса не изменяет задачу. Используйте отдельные действия отправки результата, подтверждения, возврата, повторного открытия и отмены задачи.",
  "timesheet.manual_correction":
    "Устаревшее отдельное разрешение: изменение проверяется каноническим действием «Корректировка суммы в табеле» (timesheet.amount.edit). Сохранённые коды и история не меняются; запрет timesheet.manual_correction продолжает ограничивать корректировки. Исторические ограничения и независимое согласование сохраняются.",
};

// Target-scoped warehouse actions use their target identity, never inventory item identity.
for (const action of actions) {
  // Chat rules select rooms. Message authorship/edit windows remain independent
  // invariants; room ownership must never be advertised as own-message scope.
  if (action.module === "chat")
    action.allowedScopes = ["assigned", "selected", "all"];
  // These resources have owner/selected identity, but no assignment semantics.
  if (
    [
      "one_time_order_calendar",
      "user_absences",
      "visit_plans",
      "user_substitutions",
    ].includes(action.module)
  )
    action.allowedScopes = action.allowedScopes.filter(
      (scope) => scope !== "assigned",
    );
  if (
    [
      "inventory.catalog.create",
      "equipment.catalog.read",
      "equipment.catalog.create",
      "equipment.catalog.delete",
      "equipment.unit.create",
      "inventory.references.read",
      "mats.catalog.read",
      "mats.cost.edit",
      "mats.catalog.create",
      "chat.room.direct",
      "chat.room.group",
      "files.upload",
    ].includes(action.code)
  )
    action.allowedScopes = global;
  if (action.code === "user_absences.create")
    action.allowedScopes = ["own", "selected", "all"];
  action.dependencies = action.parentAction ? [action.parentAction] : [];
  action.invariants = [
    "active_user",
    "resource_visibility",
    "domain_lifecycle",
  ];
  action.delegation =
    action.module === "objects" &&
    !/(rates|budget|coefficient|contract_amount|compensation|staffing|attendance)/.test(
      action.code,
    )
      ? "object_only"
      : "none";
  if (
    ["approvals", "accountability", "timesheet"].includes(action.module) ||
    action.code.includes("compensation")
  )
    action.invariants = [
      ...action.invariants,
      "independent_approval_where_required",
      "immutable_posted_history",
      "historical_period_rules",
    ];
  if (action.module === "inventory")
    action.invariants = [
      ...action.invariants,
      "nonnegative_stock",
      "price_snapshot",
      "idempotency",
      "evidence_requirements",
    ];
  if (action.module === "files")
    action.invariants = [...action.invariants, "authorized_parent_entity"];
  if (action.module === "chat")
    action.invariants = [
      ...action.invariants,
      "current_membership",
      "message_visibility_boundary",
      "author_and_edit_window",
    ];
  if (action.module === "notifications")
    action.invariants = [
      ...action.invariants,
      "current_recipient",
      "current_source_visibility",
    ];
  if (
    ["settings.access", "files.detach", "auth.logout"].includes(action.code)
  ) {
    action.manageable = false;
    action.constraint =
      action.code === "auth.logout"
        ? "logout_always_available"
        : "unsupported_standalone_operation";
  }
  const standaloneNote = unsupportedStandaloneActions[action.code];
  if (standaloneNote) {
    action.manageable = false;
    action.constraint = "unsupported_standalone_operation";
    action.description = `${action.name}. ${standaloneNote}`;
  }
  // Source metadata only: the existing runtime helper already consumes this
  // legacy permission. This does not alias personal rules or create a grant.
  if (action.code === "one_time_order_calendar.availability.manage")
    action.legacyPermissionCodes = [
      ...action.legacyPermissionCodes,
      "one_time_order.calendar.manage",
    ];
  if (
    [
      "one_time_orders.read",
      "one_time_orders.update",
      "one_time_orders.status",
      "one_time_orders.finance.read",
      "one_time_orders.managers.manage",
    ].includes(action.code)
  )
    action.legacyPermissionCodes = [
      ...action.legacyPermissionCodes,
      "one_time_order.manage_all",
    ];
  if (action.code === "inventory.issue_to_object") {
    action.resourceType = "object";
    action.allowedScopes = scoped;
  }
  if (action.code === "inventory.issue_to_one_time_order") {
    action.resourceType = "one_time_order";
    action.allowedScopes = ["assigned", "selected", "all"];
  }
  if (["users_access.access", "users_access.manage"].includes(action.code))
    action.constraint = "founder_only";
  if (
    ["objects.contract_amount.read", "accountability.issue_cash"].includes(
      action.code,
    )
  )
    action.constraint = "leadership_only";
  if (action.code === "inventory.resolve_missing_photo")
    action.constraint = "director_only";
  if (
    [
      "approvals.resolve_task_result",
      "approvals.resolve_object_change",
      "approvals.resolve_inventory_exception",
      "approvals.resolve_accountability",
      "approvals.resolve_timesheet",
      "accountability.expenses.approve",
      "accountability.expenses.reject",
      "accountability.closure.approve",
      "accountability.closure.reject",
      "one_time_order_calendar.availability.approve",
      "one_time_orders.specification.manage",
      "specification_catalog.access",
      "specification_catalog.read",
      "specification_catalog.create",
      "specification_catalog.update",
      "specification_catalog.archive",
    ].includes(action.code)
  ) {
    action.manageable = false;
    action.constraint = "policy_decision_required";
  }
}
actions.push({
  code: "candidates.denied",
  name: "Прежний персональный запрет кандидатов",
  description:
    "Отрицательный UserPermission; снимается отдельным согласованным workflow, не новым allow.",
  module: "candidates",
  resourceType: "candidate",
  allowedScopes: global,
  manageable: false,
  constraint: "legacy_negative",
  legacyPermissionCodes: ["candidates.denied"],
  integrationStatus: "policy_contract",
});
export const ACCESS_ACTION_CATALOG: readonly AccessActionDefinition[] = actions;
export const ACCESS_ACTION_BY_CODE = new Map(
  ACCESS_ACTION_CATALOG.map((action) => [action.code, action]),
);
export function getAccessAction(
  actionCode: string,
): AccessActionDefinition | undefined {
  return ACCESS_ACTION_BY_CODE.get(actionCode);
}
