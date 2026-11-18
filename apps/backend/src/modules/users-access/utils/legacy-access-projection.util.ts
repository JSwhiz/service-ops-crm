import { buildInventoryGlobalCapabilities } from "../../inventory/utils/inventory-capabilities.util";
import { buildEquipmentGlobalCapabilities } from "../../equipment/utils/equipment-capabilities.util";
import { buildEmployeeGlobalCapabilities } from "../../employees/utils/employee-hr-access.util";
import { buildCandidateGlobalCapabilities } from "../../candidates/utils/candidate-access.util";
import { buildCounterpartyGlobalCapabilities } from "../../counterparties/utils/counterparty-access.util";
import { buildAccountabilityGlobalCapabilities } from "../../accountability/utils/accountability-capabilities.util";
import {
  canApproveAccountabilityExpense,
  canCorrectAccountabilityReceipt,
} from "../../accountability/utils/accountability-access.util";
import { buildApprovalGlobalCapabilities } from "../../approvals/utils/approval-capabilities.util";
import { buildOneTimeOrderGlobalCapabilities } from "../../one-time-orders/utils/one-time-order-capabilities.util";
import { hasOneTimeOrderManagementAccess } from "../../one-time-orders/utils/one-time-order-access.util";
import {
  canCreateObject,
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  hasWideObjectAccess,
  LEADERSHIP_OBJECT_ROLE_CODES,
} from "../../objects/utils/object-access.util";
import {
  hasWideTimesheetAccess,
  canManuallyCorrectTimesheet,
} from "../../timesheets/utils/timesheet-access.util";
import {
  canAccessChats,
  canCreateDirectChat,
  canCreateGroupChat,
  canManageChats,
  canCloseChatGlobally,
} from "../../chats/utils/chat-access.util";
import { hasWideTaskAccess } from "../../tasks/utils/task-access.util";
import type { AccessScope, AccessSubject } from "../types/access-policy.type";

export interface LegacyAccessBaseline {
  allowed: boolean;
  scope: AccessScope;
  scopes: AccessScope[];
  source:
    | "legacy_capability"
    | "legacy_role"
    | "legacy_assignment"
    | "legacy_ownership"
    | "legacy_active_user"
    | "legacy_delegation";
  evaluator: string;
  conditions: string[];
  selectedIds?: string[];
  delegations?: Array<{
    substitutionId: string;
    principalUserId: string;
    objectId: string;
    endsAt: string;
  }>;
}
export interface LegacyProjectionFacts {
  hasActiveOneTimeManagerAssignment: boolean;
  hasHistoricalOneTimeOrderReceipt: boolean;
  isConfiguredCalendarManager: boolean;
}

/** Projection of actual legacy evaluator results, never inferred from a
 * permission alias. Resource author/lifecycle checks remain explicit conditions.
 * No delegation context or current administrator identity is consulted here. */
export function buildLegacyAccessProjection(
  subject: AccessSubject,
  facts: LegacyProjectionFacts,
): Map<string, LegacyAccessBaseline> {
  const roles = [
    ...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : [])),
  ];
  const permissions = [...(subject.permissionCodes ?? [])];
  const params = {
    roleCodes: roles,
    permissionCodes: permissions,
    ...facts,
    isActiveUser: subject.isActive !== false,
  };
  const result = new Map<string, LegacyAccessBaseline>();
  const set = (
    code: string,
    allowed: boolean,
    evaluator: string,
    scopes: AccessScope[] = ["all"],
    conditions: string[] = [],
  ) =>
    result.set(code, {
      allowed: allowed && subject.isActive !== false,
      scope: scopes[0],
      scopes,
      source: scopes.includes("assigned")
        ? "legacy_assignment"
        : scopes.includes("own")
          ? "legacy_ownership"
          : evaluator === "active_user"
            ? "legacy_active_user"
            : "legacy_capability",
      evaluator,
      conditions,
    });
  const inventory = buildInventoryGlobalCapabilities(roles, permissions);
  const inventoryMap: Record<string, boolean> = {
    access: inventory.canAccessInventory,
    read: inventory.canAccessInventory,
    "catalog.create": inventory.canManageInventoryCatalog,
    "catalog.update": inventory.canManageInventoryCatalog,
    "catalog.delete": inventory.canDeleteInventoryItem,
    "catalog.restore": inventory.canDeleteInventoryItem,
    "movements.read": inventory.canViewInventoryReports,
    receipt: inventory.canCreateInventoryReceipt,
    issue_to_object: inventory.canIssueInventoryToObject,
    issue_to_one_time_order: inventory.canIssueInventoryToOneTimeOrder,
    return: inventory.canReturnInventory,
    writeoff: inventory.canWriteoffInventory,
    adjustment: inventory.canAdjustInventory,
    reports: inventory.canViewInventoryReports,
    resolve_missing_photo: inventory.canResolveInventoryMissingPhotoApproval,
    "references.read": inventory.canCreateInventoryMovement,
  };
  for (const [code, allowed] of Object.entries(inventoryMap))
    set(`inventory.${code}`, allowed, "buildInventoryGlobalCapabilities");
  set("inventory.movement.photos.create", inventory.canCreateInventoryMovement,
    "buildInventoryGlobalCapabilities", ["own"], [
      "Собственный приход или корректировка без привязки к объекту и заказу.",
      "Текущие сутки по Москве; право загрузки файлов проверяется отдельно.",
    ]);
  if (!inventory.canIssueInventoryToObject)
    set(
      "inventory.issue_to_object",
      true,
      "active_object_manager_or_delegation",
      ["assigned"],
      [
        "active_manager_assignment",
        "writable_target",
        "stock_evidence_and_idempotency",
      ],
    );
  if (!inventory.canIssueInventoryToOneTimeOrder)
    set(
      "inventory.issue_to_one_time_order",
      true,
      "active_one_time_manager_assignment",
      ["assigned"],
      [
        "active_one_time_manager_assignment",
        "open_order",
        "stock_evidence_and_idempotency",
      ],
    );
  const equipment = buildEquipmentGlobalCapabilities(roles, permissions);
  const equipmentMap: Record<string, boolean> = {
    access: equipment.canAccessEquipment,
    read: equipment.canAccessEquipment,
    "catalog.read": equipment.canAccessEquipment,
    "catalog.create": equipment.canManageEquipmentCatalog,
    "catalog.delete": equipment.canManageEquipmentCatalog,
    "unit.create": equipment.canManageEquipmentCatalog,
    "unit.delete": equipment.canDeleteEquipmentUnit,
    history: equipment.canViewEquipmentHistory,
    assign_object: equipment.canAssignEquipmentToObject,
    assign_order: equipment.canAssignEquipmentToOneTimeOrder,
    return: equipment.canReturnEquipment,
    move: equipment.canMoveEquipment,
    broken: equipment.canMarkEquipmentBroken,
    repair: equipment.canSendEquipmentToRepair,
    repair_return: equipment.canReturnEquipmentFromRepair,
    writeoff: equipment.canWriteoffEquipment,
  };
  for (const [code, allowed] of Object.entries(equipmentMap))
    set(`equipment.${code}`, allowed, "buildEquipmentGlobalCapabilities");
  const employees = buildEmployeeGlobalCapabilities(permissions);
  const employeeMap: Record<string, boolean> = {
    access: employees.canAccessEmployeesHr,
    view: employees.canAccessEmployeesHr,
    create: employees.canCreateEmployee,
    edit: employees.canEditEmployee,
    archive: employees.canArchiveEmployee,
    restore: employees.canRestoreEmployee,
    delete_permanently: employees.canDeleteEmployeePermanently,
    "assignments.manage": employees.canManageEmployeeAssignments,
    "assignments.delete_as_error": employees.canDeleteEmployeeAssignmentAsError,
    "availability.manage": employees.canEditEmployee,
    "substitutions.manage": employees.canEditEmployee,
    "attendance.read": employees.canAccessEmployeesHr,
    "documents.edit": employees.canEditEmployee,
  };
  for (const [code, allowed] of Object.entries(employeeMap))
    set(
      `employees.${code}`,
      allowed,
      "buildEmployeeGlobalCapabilities",
      undefined,
      ["employee_lifecycle_and_dependency_rules"],
    );
  const candidates = buildCandidateGlobalCapabilities(permissions);
  for (const code of ["access", "view"])
    set(
      `candidates.${code}`,
      candidates.canAccessCandidates,
      "canViewCandidates",
    );
  for (const code of [
    "manage",
    "create",
    "update",
    "status",
    "archive",
    "restore",
    "assignments.manage",
  ])
    set(
      `candidates.${code}`,
      candidates.canManageCandidates,
      "canManageCandidates",
    );
  set(
    "candidates.convert_employee",
    candidates.canManageCandidates && employees.canCreateEmployee,
    "canManageCandidates && canCreateEmployee",
    undefined,
    ["atomic_employee_creation"],
  );
  set(
    "candidates.respond",
    candidates.canRespondToCandidates,
    "canRespondToCandidates",
    candidates.canManageCandidates ? ["all"] : ["assigned"],
    [
      "own_active_assignment_or_management_feedback",
      "does_not_close_colleague_sla",
    ],
  );
  const counterparties = buildCounterpartyGlobalCapabilities(permissions);
  for (const code of ["access", "read", "history", "inventory.read"])
    set(
      `counterparties.${code}`,
      counterparties.canAccessCounterparties,
      "canViewCounterparties",
      undefined,
      ["child_object_visibility"],
    );
  for (const code of ["create", "update", "archive", "restore"])
    set(
      `counterparties.${code}`,
      counterparties.canManageCounterparties,
      "canManageCounterparties",
    );
  for (const code of ["objects.link", "master_object.manage"])
    set(
      `counterparties.${code}`,
      counterparties.canLinkCounterpartyObjects,
      "canLinkCounterpartyObjects",
      undefined,
      ["both_entity_scopes"],
    );
  const orders = buildOneTimeOrderGlobalCapabilities(params);
  set(
    "one_time_orders.access",
    orders.canAccessOneTimeOrders,
    "canAccessOneTimeOrders",
  );
  set(
    "one_time_orders.create",
    orders.canCreateOneTimeOrder,
    "canCreateOneTimeOrder",
  );
  set(
    "one_time_orders.copy",
    orders.canCreateOneTimeOrder,
    "canCreateOneTimeOrder",
    undefined,
    ["source_order_visible"],
  );
  set(
    "one_time_orders.review.view_all",
    orders.canViewAllOneTimeOrderReviews,
    "hasWideOneTimeOrderAccess || review.view_all",
  );
  const fullOrders = hasOneTimeOrderManagementAccess(roles, permissions);
  for (const code of [
    "read",
    "finance.read",
    "update",
    "status",
    "complete",
    "comments.read",
    "comments.create",
    "reports.read",
    "reports.update",
    "photos.read",
    "photos.create",
    "photos.delete",
    "photos.restore",
    "employees.read",
    "attendance.read",
    "timesheet.read",
    "timesheet.export",
    "inventory.read",
    "equipment.read",
    "history",
  ])
    set(
      `one_time_orders.${code}`,
      true,
      "order_creator_or_active_assignment_or_full_management",
      fullOrders ? ["all"] : ["own", "assigned"],
      ["order_scope", "action_lifecycle"],
    );
  for (const code of [
    "specification.execute",
    "specification.comments",
    "specification.attachments",
    "specification.detach",
  ])
    set(
      `one_time_orders.${code}`,
      true,
      "active_one_time_manager_assignment",
      ["assigned"],
      ["active_one_time_manager_assignment", "open_order"],
    );
  set(
    "one_time_orders.review.edit",
    permissions.includes("one_time_order.review.edit"),
    "one_time_order.review.edit",
    fullOrders ? ["all"] : ["own", "assigned"],
    ["order_visible"],
  );
  set(
    "one_time_orders.managers.manage",
    true,
    "creator_or_canManageOneTimeOrderManagers",
    fullOrders ? ["all"] : ["own"],
  );
  set(
    "one_time_orders.payments.correct",
    canCorrectAccountabilityReceipt(params),
    "canCorrectAccountabilityReceipt",
    undefined,
    ["compensating_ledger_operation"],
  );
  set(
    "one_time_orders.payments.create",
    true,
    "order_operational_access",
    fullOrders ? ["all"] : ["own", "assigned"],
    ["order_visible", "payment_lifecycle"],
  );
  set(
    "one_time_orders.specification.manage",
    roles.some((role) =>
      (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role),
    ),
    "leadership_specification_contract",
    undefined,
    ["structural_edit_only", "history_snapshots"],
  );
  set(
    "one_time_orders.escorts.manage",
    permissions.includes("one_time_order.escorts.manage"),
    "one_time_order.escorts.manage",
    ["own"],
    ["available_order", "current_team", "nonempty_list"],
  );
  const calendarMap: Record<string, boolean> = {
    access: orders.canViewOneTimeOrderCalendar,
    read: orders.canViewOneTimeOrderCalendar,
    export: orders.canViewOneTimeOrderCalendar,
    manage: orders.canManageAnyOneTimeOrderAvailability,
    "availability.own": orders.canManageOwnOneTimeOrderAvailability,
    "availability.manage": orders.canManageAnyOneTimeOrderAvailability,
    "availability.approve": orders.canApproveOneTimeOrderAvailability,
  };
  for (const [code, allowed] of Object.entries(calendarMap))
    set(
      `one_time_order_calendar.${code}`,
      allowed,
      "buildOneTimeOrderGlobalCapabilities",
      code === "availability.own" ? ["own"] : ["all"],
      ["configured_manager_and_availability_lifecycle_where_required"],
    );
  const wideObjects = hasWideObjectAccess(roles),
    leadership = canEditObject(roles),
    rateManager = canEditObjectDailyRate(roles);
  const objectScopes: AccessScope[] = wideObjects
    ? ["all"]
    : ["own", "assigned"];
  set("objects.access", true, "active_user");
  set("objects.create", canCreateObject(roles), "canCreateObject");
  for (const code of [
    "update",
    "status",
    "freeze",
    "archive",
    "restore",
    "contacts.manage",
    "materials.manage",
  ])
    set(`objects.${code}`, leadership, "canEditObject", undefined, [
      "object_visibility",
      "lifecycle",
      "object_delegation_where_supported",
    ]);
  set(
    "objects.responsibles.manage",
    canManageObjectResponsibles(roles),
    "canManageObjectResponsibles",
    undefined,
    ["last_responsible_preserved"],
  );
  set(
    "objects.managers.manage",
    true,
    "leadership_or_object_responsible",
    leadership ? ["all"] : ["assigned"],
    ["responsible_assignment_required_for_nonleadership"],
  );
  for (const code of [
    "read",
    "history",
    "contacts.read",
    "materials.read",
    "arrival.read",
    "arrival.create",
    "reports.read",
    "reports.update",
    "reports.submit",
    "comments.read",
    "comments.create",
    "staffing.read",
    "attendance.read",
    "attendance.edit",
    "schedules.read",
    "schedules.manage",
    "compensation.read",
    "inventory.read",
    "inventory.issue",
    "equipment.read",
    "linked_orders.read",
  ])
    set(`objects.${code}`, true, "canViewObjectByScope", objectScopes, [
      "resource_scope",
      "action_lifecycle",
    ]);
  set(
    "objects.compensation.manage",
    rateManager,
    "canEditObjectDailyRate",
    undefined,
    ["dated_terms", "future_only"],
  );
  set(
    "objects.compensation.adjust",
    true,
    "rate_manager_or_assigned_object_manager",
    rateManager ? ["all"] : ["assigned"],
    ["non_extra_work_requires_rate_manager", "past_date_independent_approval"],
  );
  set(
    "objects.compensation.correct_past",
    leadership,
    "independent_leadership_financial_decision",
    undefined,
    ["not_author", "pending_request", "specific_approval_authority"],
  );
  if (permissions.includes("objects.view_hr"))
    set("objects.read", true, "hasHrObjectView", undefined, [
      "basic_profile_projection_only",
    ]);
  if (permissions.includes("objects.hr_reports_view"))
    set("objects.reports.read", true, "objects.hr_reports_view", undefined, [
      "reports_only_no_other_object_operations",
    ]);
  set(
    "objects.hr_reports_view",
    permissions.includes("objects.hr_reports_view"),
    "objects.hr_reports_view",
  );
  set(
    "objects.view_hr",
    permissions.includes("objects.view_hr"),
    "hasHrObjectView",
  );
  set("objects.rates.manage", rateManager, "canEditObjectDailyRate");
  set(
    "objects.rates.read",
    true,
    "canViewObjectCompensationRates",
    rateManager ? ["all"] : objectScopes,
  );
  set(
    "objects.staffing.manage",
    employees.canManageEmployeeAssignments,
    "canManageEmployeeAssignments",
    objectScopes,
    ["employee_scope_and_object_visibility"],
  );
  set(
    "objects.budget.edit",
    roles.some((role) => ["founder", "director"].includes(role)) ||
      permissions.includes("object.budget_edit"),
    "founder_or_director_or_object.budget_edit",
  );
  set("objects.budget.read", true, "canViewObjectByScope", objectScopes);
  set("objects.contract_amount.read", leadership, "leadership_contract_amount");
  set(
    "objects.coefficient.edit",
    permissions.includes("object.coefficient_edit"),
    "object.coefficient_edit",
  );
  set(
    "objects.pay_conditions.select",
    true,
    "rate_manager_or_assigned_object_manager",
    rateManager ? ["all"] : ["assigned"],
    ["existing_active_condition_of_same_object"],
  );
  const wideTimesheets = hasWideTimesheetAccess(roles);
  set("timesheet.access", true, "active_user");
  for (const code of [
    "read",
    "overview",
    "export",
    "attendance.edit",
    "corrections.read",
  ])
    set(
      `timesheet.${code}`,
      true,
      "hasWideTimesheetAccess_or_object_scope",
      wideTimesheets ? ["all"] : ["assigned"],
      ["visible_object", "historical_rows_preserved"],
    );
  for (const code of ["amount.edit", "manual_correction"])
    set(
      `timesheet.${code}`,
      canManuallyCorrectTimesheet(roles),
      "canManuallyCorrectTimesheet",
      undefined,
      [
        "past_date_requires_other_leadership_approval",
        "period_open",
        "reason_required",
      ],
    );
  set(
    "timesheet.exceptions.create",
    true,
    "visible_object_exception_request",
    wideTimesheets ? ["all"] : ["assigned"],
    ["independent_approval", "period_and_lifecycle_rules"],
  );
  const accountability = buildAccountabilityGlobalCapabilities(params);
  const accountMap: Record<string, boolean> = {
    access: accountability.canAccessAccountability,
    review: accountability.canReviewAccountability,
    issue_cash: accountability.canIssueAccountabilityFunds,
    correct_receipt: canCorrectAccountabilityReceipt(params),
    "expenses.approve": canApproveAccountabilityExpense(params),
    "expenses.reject": canApproveAccountabilityExpense(params),
    "closure.approve": accountability.canApproveAccountabilityClosure,
    "closure.reject": accountability.canApproveAccountabilityClosure,
  };
  for (const [code, allowed] of Object.entries(accountMap))
    set(
      `accountability.${code}`,
      allowed,
      "accountability_legacy_capability",
      undefined,
      ["immutable_posted_history", "independent_approval_where_required"],
    );
  set(
    "accountability.read",
    accountability.canReviewAccountability ||
      accountability.canViewOwnAccountability,
    "canReviewAccountability || canViewOwnAccountability",
    accountability.canReviewAccountability ? ["all"] : ["own"],
  );
  set(
    "accountability.external_receipt",
    accountability.canRecordExternalReceipt,
    "active_user",
    ["own"],
    ["source_and_comment", "no_order_receipt_duplication"],
  );
  for (const code of [
    "expenses.create",
    "expenses.update",
    "expenses.submit",
    "closure.request",
  ])
    set(
      `accountability.${code}`,
      code === "expenses.create" ? params.isActiveUser : accountability.canViewOwnAccountability,
      code === "expenses.create" ? "active_user_own_expense_create" : "canViewOwnAccountability",
      ["own"],
      ["account_and_document_lifecycle"],
    );
  const approvals = buildApprovalGlobalCapabilities(params);
  const approvalMap: Record<string, boolean> = {
    access: approvals.canAccessApprovals,
    resolve_task_result: approvals.canResolveTaskResultApproval,
    resolve_inventory_exception: approvals.canResolveInventoryApproval,
    resolve_object_change: approvals.canResolveObjectChangeApproval,
    resolve_accountability: approvals.canResolveAccountabilityApproval,
    resolve_timesheet: approvals.canResolveTimesheetApproval,
  };
  for (const [code, allowed] of Object.entries(approvalMap))
    set(
      `approvals.${code}`,
      allowed,
      "buildApprovalGlobalCapabilities",
      undefined,
      ["exact_approval_type_resolver", "independent_approval_where_required"],
    );
  set(
    "approvals.read",
    true,
    "requester_or_eligible_type_resolver",
    ["own"],
    ["own_requests_union_resolvable_types", "source_visibility"],
  );
  set(
    "approvals.cancel",
    true,
    "request_created_by_user",
    ["own"],
    ["cancellable_type", "pending_request"],
  );
  for (const code of ["access", "read", "view_all"])
    set(`user_absences.${code}`, true, "active_user", undefined, [
      "foreign_free_busy_only",
    ]);
  for (const code of ["create", "update", "delete"])
    set(
      `user_absences.${code}`,
      true,
      "self_calendar_or_user_absences.manage",
      permissions.includes("user_absences.manage") ? ["all"] : ["own"],
      ["target_user"],
    );
  set(
    "user_absences.manage",
    permissions.includes("user_absences.manage"),
    "user_absences.manage",
  );
  set(
    "user_absences.view_private_reasons",
    true,
    "self_or_user_absences.view_private_reasons",
    permissions.includes("user_absences.view_private_reasons")
      ? ["all"]
      : ["own"],
  );
  for (const code of ["access", "read", "history"])
    set(
      `visit_plans.${code}`,
      true,
      "self_or_planner_or_leadership",
      leadership || permissions.includes("visit_plans.manage")
        ? ["all"]
        : ["own"],
    );
  for (const code of ["manage", "visits.manage", "reports.manage"])
    set(
      `visit_plans.${code}`,
      permissions.includes("visit_plans.manage"),
      "visit_plans.manage",
    );
  for (const code of ["access", "read", "create", "revoke"])
    set(
      `user_substitutions.${code}`,
      true,
      "involved_user_or_objects.substitution.manage",
      permissions.includes("objects.substitution.manage") ? ["all"] : ["own"],
      ["involved_principal_or_replacement", "explicit_objects", "time_bounded"],
    );
  set(
    "user_substitutions.manage",
    permissions.includes("objects.substitution.manage"),
    "objects.substitution.manage",
  );
  for (const code of ["access", "read", "history"])
    set(`mats.${code}`, true, "canViewObjectByScope", objectScopes, [
      "visible_object",
    ]);
  set("mats.catalog.read", true, "active_user");
  for (const code of ["catalog.create", "cost.edit"])
    set(`mats.${code}`, wideObjects, "hasWideObjectAccess");
  set(
    "mats.quantity.edit",
    true,
    "wide_object_role_or_active_manager_responsible",
    wideObjects ? ["all"] : ["assigned"],
    ["writable_object", "migration_ready"],
  );
  set("tasks.access", true, "active_user");
  set("tasks.create", true, "active_user", undefined, [
    "visible_target",
    "eligible_assignee",
  ]);
  for (const code of ["read", "history"])
    set(
      `tasks.${code}`,
      true,
      "hasWideTaskAccess_or_author_or_participant",
      hasWideTaskAccess(roles) ? ["all"] : ["own", "assigned"],
      ["target_visibility"],
    );
  set("chat.access", canAccessChats(), "canAccessChats");
  set("chat.room.direct", canCreateDirectChat(), "canCreateDirectChat");
  set("chat.room.group", canCreateGroupChat(roles), "canCreateGroupChat");
  set(
    "chat.room.update",
    canManageChats(roles),
    "canManageChats",
    ["assigned"],
    ["current_room_access"],
  );
  set(
    "chat.room.manage_members",
    canManageChats(roles) || permissions.includes("chat.room.manage_members"),
    "chat_admin_or_manage_members",
    ["assigned"],
    ["current_group_access", "system_room_restrictions"],
  );
  set(
    "chat.room.close_global",
    canCloseChatGlobally(permissions),
    "canCloseChatGlobally",
    ["assigned"],
    ["current_room_access", "group_only"],
  );
  for (const code of [
    "read",
    "search",
    "room.hide",
    "room.unhide",
    "room.leave",
    "messages.read",
    "messages.create",
    "messages.edit",
    "messages.delete",
    "messages.forward",
    "messages.react",
    "read_receipts",
    "realtime",
  ])
    set(
      `chat.${code}`,
      true,
      "current_room_visibility_and_membership",
      ["assigned"],
      [
        "room_visibility",
        "author_and_edit_window_where_required",
        "source_and_destination_forward_visibility",
      ],
    );
  for (const code of ["access", "read", "mark_read", "dismiss", "realtime"])
    set(
      `notifications.${code}`,
      true,
      "notification_recipient",
      ["own"],
      ["current_source_visibility", "dismiss_only_read"],
    );
  for (const code of ["access", "query", "recent"])
    set(`search.${code}`, true, "active_user", undefined, [
      "every_result_domain_scope_and_field_policy",
    ]);
  for (const code of ["access", "login", "me", "refresh", "logout"])
    set(
      `auth.${code}`,
      true,
      "active_user",
      ["own"],
      ["credentials_and_session_lifecycle"],
    );
  set("dashboard.access", true, "active_user");
  set("dashboard.view", true, "active_user");
  set(
    "dashboard.leadership.view",
    hasWideObjectAccess(roles),
    "leadership_dashboard_roles",
  );
  set(
    "dashboard.manager.view",
    roles.some((role) =>
      ["manager", "senior_manager", "operation_manager"].includes(role),
    ),
    "manager_dashboard_roles",
  );
  set(
    "dashboard.operations.view",
    roles.includes("operation_manager"),
    "operation_manager_role",
  );
  set("dashboard.hr.view", roles.includes("hr"), "hr_role");
  for (const code of ["users_access.access", "users_access.manage"])
    set(code, roles.includes("founder"), "founder_role");
  return result;
}
