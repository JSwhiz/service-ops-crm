import type { Prisma } from "@prisma/client";
import {
  resourceAccessTarget,
  type ResourceAccessTarget,
} from "../../../common/access/resource-access-context";
import { LEADERSHIP_OBJECT_ROLE_CODES } from "../../objects/utils/object-access.util";
import type { PrismaService } from "../../prisma/prisma.service";
import type {
  AccessContext,
  AccessSubject,
} from "../../users-access/types/access-policy.type";
import {
  buildAccessWhere,
  decideAccess,
} from "../../users-access/utils/access-policy.util";
import {
  APPROVAL_SOURCE_ENTITY_TYPES,
  MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
} from "../constants/approval.constants";
import { getResolvableApprovalTypes } from "./approval-capabilities.util";

export interface ApprovalReadReference {
  id: string;
  createdByUserId: string;
  sourceEntityType: string;
  sourceEntityId: string;
}

/** Legacy inheritance only, not a ceiling on an explicit OQ-153 read grant. */
export function approvalLegacyReadWhere(
  subject: AccessSubject,
): Prisma.ApprovalRequestWhereInput {
  const roleCodes = [
    ...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : [])),
  ];
  const resolvableTypes = getResolvableApprovalTypes({
    roleCodes,
    permissionCodes: [...(subject.permissionCodes ?? [])],
  });
  if (!resolvableTypes.length) return { createdByUserId: subject.id };
  const retroactive: Prisma.ApprovalRequestWhereInput[] = roleCodes.some(
    (role) =>
      (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role),
  )
    ? [
        {
          approvalType: MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE,
          payloadSnapshot: {
            path: ["independentLeadershipRequired"],
            equals: true,
          },
        },
      ]
    : [];
  return {
    OR: [
      ...retroactive,
      { createdByUserId: subject.id },
      { approvalType: { in: resolvableTypes } },
    ],
  };
}

/** Pure SQL authorization union. Source denies are applied by the bounded helper below. */
export function approvalReadWhere(
  subject: AccessSubject,
): Prisma.ApprovalRequestWhereInput {
  return buildAccessWhere<Prisma.ApprovalRequestWhereInput>({
    subject,
    actionCode: "approvals.read",
    legacyWhere: approvalLegacyReadWhere(subject),
    // OQ-153: legacy read eligibility is inheritance, not a business invariant.
    invariantWhere: {},
    scopeWhere: (rule) =>
      rule.scope === "all"
        ? {}
        : rule.scope === "selected"
          ? { id: { in: [...rule.selectedIds] } }
          : null,
  }) as Prisma.ApprovalRequestWhereInput;
}

/** Pure composition with a server-resolved source identity; never reinterpret an opaque ID. */
export function approvalReadContext(
  request: ApprovalReadReference,
  source: ResourceAccessTarget | null,
): AccessContext {
  return {
    resourceType: "approval",
    resourceId: request.id,
    ownerUserId: request.createdByUserId,
    ...(source
      ? { parents: [source] }
      : (APPROVAL_SOURCE_ENTITY_TYPES as readonly string[]).includes(
            request.sourceEntityType,
          )
        ? { parentAllowed: false }
        : {}),
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Only known source fields carry Employee identity. Do not scan arbitrary UUIDs
 * or derive an Employee from a display name, User ID or object ID. */
function adjustmentEmployeeIds(row: {
  employeeId: string | null;
  payload: unknown;
  beforeSnapshot: unknown;
}): string[] {
  const payload = jsonObject(row.payload);
  const snapshot = jsonObject(row.beforeSnapshot);
  const before = Array.isArray(row.beforeSnapshot)
    ? row.beforeSnapshot
    : [row.beforeSnapshot];
  return [
    ...new Set(
      [
        row.employeeId,
        payload.employeeId,
        payload.replacementEmployeeId,
        ...(Array.isArray(payload.employeeIds) ? payload.employeeIds : []),
        ...(Array.isArray(payload.holidayEmployeeIds) ? payload.holidayEmployeeIds : []),
        ...before.map((item) => jsonObject(item).employeeId),
        ...(Array.isArray(snapshot.facts) ? snapshot.facts.map((item) => jsonObject(item).employeeId) : []),
        ...(Array.isArray(snapshot.holidays) ? snapshot.holidays.map((item) => jsonObject(item).employeeId) : []),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

async function employeeReadSources(prisma: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length)
    return { complete: true, parents: [] as ResourceAccessTarget[] };
  // A malformed historical source must not cause an unbounded lookup or drop denies.
  if (ids.length > 200)
    return { complete: false, parents: [] as ResourceAccessTarget[] };
  const rows = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return {
    complete: rows.length === ids.length,
    parents: rows.map(
      (employee): ResourceAccessTarget => ({
        actionCode: "employees.view",
        context: { resourceType: "employee", resourceId: employee.id },
      }),
    ),
  };
}

/** Readonly source facts shared by endpoint and background consumers. No positive
 * source grant is required: OQ-153 permits independent approval reading, while
 * each actual source/ancestor's explicit read denial still wins. */
export async function approvalSourceReadContext(
  prisma: Prisma.TransactionClient,
  request: ApprovalReadReference,
): Promise<AccessContext> {
  let source = await resourceAccessTarget(
    prisma,
    request.sourceEntityType,
    request.sourceEntityId,
  );
  if (request.sourceEntityType === "object_compensation_adjustment") {
    const row = await prisma.objectCompensationAdjustment.findUnique({
      where: { id: request.sourceEntityId },
      select: {
        objectId: true,
        employeeId: true,
        payload: true,
        beforeSnapshot: true,
      },
    });
    const object = row
      ? await resourceAccessTarget(prisma, "object", row.objectId)
      : null;
    const employees = await employeeReadSources(
      prisma,
      row ? adjustmentEmployeeIds(row) : [],
    );
    source =
      object && employees.complete
        ? {
            actionCode: "objects.compensation.read",
            // The stored approval contains amounts/rate snapshots and Employee names.
            // A finer explicit deny conservatively hides the entire approval payload.
            context: {
              ...object.context,
              parents: [
                object,
                { actionCode: "objects.rates.read", context: object.context },
                ...employees.parents,
              ],
            },
          }
        : null;
  }
  if (request.sourceEntityType === "timesheet_exception") {
    const row = await prisma.timesheetManualException.findUnique({
      where: { id: request.sourceEntityId },
      select: { objectId: true, employeeId: true },
    });
    const object = row
      ? await resourceAccessTarget(prisma, "object", row.objectId)
      : null;
    const employees = await employeeReadSources(
      prisma,
      row ? [row.employeeId] : [],
    );
    source =
      object && employees.complete
        ? {
            actionCode: "timesheet.read",
            context: {
              ...object.context,
              parents: [object, ...employees.parents],
            },
          }
        : null;
  }
  if (!source && request.sourceEntityType === "accountability_closure") {
    const row = await prisma.accountabilityClosure.findUnique({
      where: { id: request.sourceEntityId },
      select: { accountabilityAccount: { select: { userId: true } } },
    });
    if (row)
      source = {
        actionCode: "accountability.read",
        context: {
          resourceType: "user",
          resourceId: row.accountabilityAccount.userId,
          ownerUserId: row.accountabilityAccount.userId,
        },
      };
  }
  if (!source && request.sourceEntityType === "one_time_manager_availability") {
    const row = await prisma.oneTimeManagerAvailability.findUnique({
      where: { id: request.sourceEntityId },
      select: { userId: true },
    });
    if (row)
      source = {
        actionCode: "one_time_order_calendar.read",
        context: {
          resourceType: "user",
          resourceId: row.userId,
          ownerUserId: row.userId,
        },
      };
  }
  return approvalReadContext(request, source);
}

/** The caller supplies a fresh subject and owns any isolated delegation context.
 * candidateIds bounds notification work to the recipient's actual references.
 * The result must be intersected with the caller's filters before take/count. */
export async function approvalReadVisibilityWhere(
  prisma: PrismaService,
  subject: AccessSubject,
  candidateIds?: readonly string[],
): Promise<Prisma.ApprovalRequestWhereInput> {
  if (candidateIds?.length === 0 || subject.isActive === false)
    return { id: { in: [] } };
  const policy = approvalReadWhere(subject);
  const where: Prisma.ApprovalRequestWhereInput =
    candidateIds === undefined
      ? policy
      : { AND: [policy, { id: { in: [...new Set(candidateIds)] } }] };
  if (
    !subject.accessRules?.length &&
    !subject.permissionCodes?.includes("candidates.denied")
  )
    return where;
  const rows = await prisma.approvalRequest.findMany({
    where,
    select: {
      id: true,
      createdByUserId: true,
      sourceEntityType: true,
      sourceEntityId: true,
    },
  });
  const permitted = await Promise.all(
    rows.map(async (request) =>
      decideAccess(
        subject,
        "approvals.read",
        true,
        await approvalSourceReadContext(prisma, request),
      )
        ? request.id
        : null,
    ),
  );
  return {
    AND: [
      where,
      { id: { in: permitted.filter((id): id is string => id !== null) } },
    ],
  };
}
