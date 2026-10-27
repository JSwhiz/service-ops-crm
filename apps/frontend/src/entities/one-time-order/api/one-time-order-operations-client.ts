import { fetcher } from "@/shared/api/fetcher";

export interface OrderEscorts {
  currentUserId: string;
  canManageOwn: boolean;
  items: Array<{
    id: string;
    version: number;
    operationDate: string;
    escort: { id: string; fullName: string };
    updatedBy: { fullName: string };
    updatedAt: string;
    employees: Array<{
      employeeId: string;
      employee: { id: string; fullName: string };
    }>;
  }>;
}
export interface OrderServiceLines {
  version: number;
  agreedSum: number | null;
  allocatedTotal: number;
  isReconciled: boolean;
  canEdit: boolean;
  lines: Array<{ id: string; serviceCode: string; amount: number }>;
}
export interface OrderDeadline {
  deadlineAt: string | null;
  updatedAt: string;
  canEdit: boolean;
}
export const getOrderEscorts = (
  id: string,
  date: string,
): Promise<OrderEscorts> =>
  fetcher(`/one-time-orders/${id}/escorts?${new URLSearchParams({ date })}`);
export const saveOrderEscorts = (
  id: string,
  payload: {
    operationDate: string;
    expectedVersion: number;
    employeeIds: string[];
  },
): Promise<unknown> =>
  fetcher(`/one-time-orders/${id}/escorts`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
export const getOrderServiceLines = (id: string): Promise<OrderServiceLines> =>
  fetcher(`/one-time-orders/${id}/service-lines`);
export const saveOrderServiceLines = (
  id: string,
  payload: {
    expectedVersion: number;
    lines: Array<{ serviceCode: string; amount: number }>;
    agreedSum?: number;
  },
): Promise<OrderServiceLines> =>
  fetcher(`/one-time-orders/${id}/service-lines`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
export const getOrderDeadline = (id: string): Promise<OrderDeadline> =>
  fetcher(`/one-time-orders/${id}/deadline`);
export const saveOrderDeadline = (
  id: string,
  payload: { expectedUpdatedAt: string; deadlineAt: string | null },
): Promise<OrderDeadline> =>
  fetcher(`/one-time-orders/${id}/deadline`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
