import type { AccessContext } from "../types/access-policy.type";

export function objectPolicyContext(object: {
  id?: string;
  createdByUserId: string;
  assignments: readonly { userId: string; isActive?: boolean }[];
}): AccessContext {
  return {
    resourceType: "object",
    resourceId: object.id,
    ownerUserId: object.createdByUserId,
    assignedUserIds: object.assignments
      .filter((item) => item.isActive !== false)
      .map((item) => item.userId),
  };
}
