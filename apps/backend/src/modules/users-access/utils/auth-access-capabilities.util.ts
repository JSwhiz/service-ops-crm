import {
  canEditObject,
  hasWideObjectAccess,
} from "../../objects/utils/object-access.util";
import { hasWideTimesheetAccess } from "../../timesheets/utils/timesheet-access.util";
import { hasOneTimeOrderManagementAccess } from "../../one-time-orders/utils/one-time-order-access.util";
import { AccessScope, AccessSubject } from "../types/access-policy.type";
import { decideAccess } from "./access-policy.util";
import { canEnterAccessModule } from "./access-summary.util";

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
  const roles = [
    ...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : [])),
  ];
  const permissions = [...(subject.permissionCodes ?? [])];
  const objectScopes: readonly AccessScope[] =
    hasWideObjectAccess(roles) || permissions.includes("objects.view_hr")
      ? ["all"]
      : ["own", "assigned"];
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
  // A personal order grant uses the order-scoped endpoint, not the generic
  // inventory form. Keep the same generic issuer invariant as its domain helper.
  if ("canIssueInventoryToOneTimeOrder" in result)
    result["canIssueInventoryToOneTimeOrder" as keyof T] =
      (result.canIssueInventoryToOneTimeOrder &&
        legacy.canIssueInventoryToOneTimeOrder) as T[keyof T];
  if ("canCreateInventoryMovement" in result)
    result["canCreateInventoryMovement" as keyof T] =
      (result.canCreateInventoryReceipt ||
        result.canIssueInventoryToObject ||
        result.canIssueInventoryToOneTimeOrder ||
        result.canReturnInventory ||
        result.canWriteoffInventory ||
        result.canAdjustInventory) as T[keyof T];
  if ("canManageEmployeesHr" in result)
    result["canManageEmployeesHr" as keyof T] = (result.canCreateEmployee ||
      result.canEditEmployee) as T[keyof T];
  const navigation: Record<string, [string, string]> = {
    canAccessCounterparties: ["counterparties.access", "counterparties.read"],
    canAccessCandidates: ["candidates.access", "candidates.view"],
    canAccessEmployeesHr: ["employees.access", "employees.view"],
    canAccessApprovals: ["approvals.access", "approvals.read"],
    canAccessOneTimeOrders: ["one_time_orders.access", "one_time_orders.read"],
    canViewOneTimeOrderCalendar: [
      "one_time_order_calendar.access",
      "one_time_order_calendar.read",
    ],
    canAccessAccountability: ["accountability.access", "accountability.read"],
    canAccessInventory: ["inventory.access", "inventory.read"],
    canAccessEquipment: ["equipment.access", "equipment.read"],
    canAccessChats: ["chat.access", "chat.read"],
  };
  const navigationScopes: Record<string, readonly AccessScope[]> = {
    canAccessChats: ["assigned"],
    canAccessAccountability: legacy.canReviewAccountability ? ["all"] : ["own"],
    canAccessOneTimeOrders: hasOneTimeOrderManagementAccess(roles, permissions)
      ? ["all"]
      : ["own", "assigned"],
    // Resolver eligibility is type-specific, not unrestricted all-approval read.
    // It can nevertheless leave navigable requests after an own-scope deny.
    canAccessApprovals: [
      "canResolveTaskResultApproval",
      "canResolveInventoryApproval",
      "canResolveObjectChangeApproval",
      "canResolveAccountabilityApproval",
      "canResolveTimesheetApproval",
    ].some((key) => legacy[key])
      ? ["all"]
      : ["own"],
  };
  for (const [key, [moduleAction, readAction]] of Object.entries(navigation)) {
    if (key in legacy)
      result[key as keyof T] = canEnterAccessModule(
        subject,
        moduleAction,
        [readAction],
        legacy[key],
        navigationScopes[key],
      ) as T[keyof T];
  }
  // Independent read-only entry points can keep a module navigable without
  // implicitly granting its item/object registry or any mutation.
  if ("canAccessInventory" in result)
    result["canAccessInventory" as keyof T] = (result.canAccessInventory ||
      canEnterAccessModule(
        subject,
        "inventory.access",
        ["inventory.reports"],
        legacy.canViewInventoryReports === true,
      )) as T[keyof T];
  if ("canAccessEquipment" in result)
    result["canAccessEquipment" as keyof T] = (result.canAccessEquipment ||
      canEnterAccessModule(
        subject,
        "equipment.access",
        ["equipment.catalog.read"],
        legacy.canAccessEquipment === true,
      )) as T[keyof T];
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
    canAccessObjects: canEnterAccessModule(
      subject,
      "objects.access",
      ["objects.read"],
      true,
      objectScopes,
    ),
    canAccessMats:
      canEnterAccessModule(
        subject,
        "mats.access",
        ["mats.read"],
        true,
        objectScopes,
      ) ||
      canEnterAccessModule(subject, "mats.access", ["mats.catalog.read"], true),
    canAccessTasks: canEnterAccessModule(
      subject,
      "tasks.access",
      ["tasks.read"],
      true,
    ),
    canAccessTimesheet: canEnterAccessModule(
      subject,
      "timesheet.access",
      ["timesheet.read"],
      true,
      hasWideTimesheetAccess(roles) ? ["all"] : ["assigned"],
    ),
    canAccessUserAbsences: canEnterAccessModule(
      subject,
      "user_absences.access",
      ["user_absences.read"],
      true,
    ),
    canAccessVisitPlans: canEnterAccessModule(
      subject,
      "visit_plans.access",
      ["visit_plans.read"],
      true,
      canEditObject(roles) || permissions.includes("visit_plans.manage")
        ? ["all"]
        : ["own"],
    ),
    canAccessUserSubstitutions: canEnterAccessModule(
      subject,
      "user_substitutions.access",
      ["user_substitutions.read"],
      true,
      permissions.includes("objects.substitution.manage") ? ["all"] : ["own"],
    ),
    canAccessDashboard: canEnterAccessModule(
      subject,
      "dashboard.access",
      ["dashboard.view"],
      true,
    ),
    canManageUserAccess: decideAccess(
      subject,
      "users_access.manage",
      subject.roleCodes?.includes("founder") === true,
    ),
  };
}
