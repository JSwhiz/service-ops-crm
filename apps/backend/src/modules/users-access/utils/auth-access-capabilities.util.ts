import { AccessSubject } from "../types/access-policy.type";
import { decideAccess } from "./access-policy.util";

const actions: Record<string, string> = {
  canAccessCounterparties: "counterparties.access",
  canManageCounterparties: "counterparties.update",
  canLinkCounterpartyObjects: "counterparties.objects.link",
  canAccessCandidates: "candidates.access",
  canManageCandidates: "candidates.manage",
  canRespondToCandidates: "candidates.respond",
  canAccessApprovals: "approvals.access",
  canResolveTaskResultApproval: "approvals.resolve_task_result",
  canResolveInventoryApproval: "approvals.resolve_inventory_exception",
  canResolveObjectChangeApproval: "approvals.resolve_object_change",
  canResolveAccountabilityApproval: "approvals.resolve_accountability",
  canResolveTimesheetApproval: "approvals.resolve_timesheet",
  canCreateObject: "objects.create",
  canAccessOneTimeOrders: "one_time_orders.access",
  canCreateOneTimeOrder: "one_time_orders.create",
  canViewAllOneTimeOrderReviews: "one_time_orders.review.view_all",
  canViewOneTimeOrderCalendar: "one_time_order_calendar.read",
  canManageOwnOneTimeOrderAvailability:
    "one_time_order_calendar.availability.own",
  canManageAnyOneTimeOrderAvailability:
    "one_time_order_calendar.availability.manage",
  canApproveOneTimeOrderAvailability:
    "one_time_order_calendar.availability.approve",
  canAccessEmployeesHr: "employees.access",
  canManageEmployeesHr: "employees.edit",
  canCreateEmployee: "employees.create",
  canEditEmployee: "employees.edit",
  canArchiveEmployee: "employees.archive",
  canRestoreEmployee: "employees.restore",
  canDeleteEmployeePermanently: "employees.delete_permanently",
  canManageEmployeeAssignments: "employees.assignments.manage",
  canDeleteEmployeeAssignmentAsError: "employees.assignments.delete_as_error",
  canAccessAccountability: "accountability.access",
  canViewOwnAccountability: "accountability.read",
  canIssueAccountabilityFunds: "accountability.issue_cash",
  canReviewAccountability: "accountability.review",
  canApproveAccountabilityClosure: "accountability.closure.approve",
  canRecordExternalReceipt: "accountability.external_receipt",
  canAccessInventory: "inventory.access",
  canManageInventoryCatalog: "inventory.catalog.update",
  canDeleteInventoryItem: "inventory.catalog.delete",
  canCreateInventoryReceipt: "inventory.receipt",
  canIssueInventoryToObject: "inventory.issue_to_object",
  canIssueInventoryToOneTimeOrder: "inventory.issue_to_one_time_order",
  canReturnInventory: "inventory.return",
  canWriteoffInventory: "inventory.writeoff",
  canAdjustInventory: "inventory.adjustment",
  canViewInventoryReports: "inventory.reports",
  canResolveInventoryMissingPhotoApproval: "inventory.resolve_missing_photo",
  canAccessEquipment: "equipment.access",
  canManageEquipmentCatalog: "equipment.catalog.create",
  canDeleteEquipmentUnit: "equipment.unit.delete",
  canAssignEquipmentToObject: "equipment.assign_object",
  canAssignEquipmentToOneTimeOrder: "equipment.assign_order",
  canReturnEquipment: "equipment.return",
  canMoveEquipment: "equipment.move",
  canMarkEquipmentBroken: "equipment.broken",
  canSendEquipmentToRepair: "equipment.repair",
  canReturnEquipmentFromRepair: "equipment.repair_return",
  canWriteoffEquipment: "equipment.writeoff",
  canViewEquipmentHistory: "equipment.history",
  canAccessChats: "chat.access",
  canManageChats: "chat.room.update",
  canCreateDirectChat: "chat.room.direct",
  canCreateGroupChat: "chat.room.group",
};

export function applyAccessCapabilities<T extends Record<string, boolean>>(
  subject: AccessSubject,
  legacy: T,
) {
  const context = {
    resourceType: "user",
    resourceId: subject.id,
    ownerUserId: subject.id,
  };
  const result = { ...legacy };
  for (const key of Object.keys(legacy)) {
    if (actions[key])
      result[key as keyof T] = decideAccess(
        subject,
        actions[key],
        legacy[key],
        context,
      ) as T[keyof T];
  }
  if ("canCreateInventoryMovement" in result)
    result["canCreateInventoryMovement" as keyof T] =
      (legacy.canCreateInventoryMovement &&
        decideAccess(subject, "inventory.access", true)) as T[keyof T];
  return {
    ...result,
    canCreateTask: decideAccess(subject, "tasks.create", true),
    canCreateCandidate: decideAccess(
      subject,
      "candidates.create",
      legacy.canManageCandidates === true,
    ),
    canCreateCounterparty: decideAccess(
      subject,
      "counterparties.create",
      legacy.canManageCounterparties === true,
    ),
    canCreateInventoryItem: decideAccess(
      subject,
      "inventory.catalog.create",
      legacy.canManageInventoryCatalog === true,
    ),
    canCreateEquipmentUnit: decideAccess(
      subject,
      "equipment.unit.create",
      legacy.canManageEquipmentCatalog === true,
    ),
    canAccessSearch: decideAccess(subject, "search.query", true),
    canAccessNotifications: decideAccess(subject, "notifications.read", true, {
      resourceType: "notification",
      ownerUserId: subject.id,
    }),
    canAccessObjects: decideAccess(subject, "objects.access", true),
    canAccessMats: decideAccess(subject, "mats.access", true),
    canAccessTasks: decideAccess(subject, "tasks.access", true),
    canAccessTimesheet: decideAccess(subject, "timesheet.access", true),
    canAccessUserAbsences: decideAccess(
      subject,
      "user_absences.access",
      true,
      context,
    ),
    canAccessVisitPlans: decideAccess(
      subject,
      "visit_plans.access",
      true,
      context,
    ),
    canAccessUserSubstitutions: decideAccess(
      subject,
      "user_substitutions.access",
      true,
    ),
    canAccessDashboard: decideAccess(subject, "dashboard.access", true),
    canManageUserAccess: decideAccess(
      subject,
      "users_access.manage",
      subject.roleCodes?.includes("founder") === true,
    ),
  };
}
