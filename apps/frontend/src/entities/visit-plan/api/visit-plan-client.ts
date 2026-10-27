import { fetcher } from "@/shared/api/fetcher";

export interface VisitPlan {
  id: string;
  planDate: string;
  version: number;
  manager: { id: string; fullName: string };
  createdBy: { id: string; fullName: string };
  report: string | null;
  reportDueAt: string | null;
  reportClosedAt: string | null;
  entries: Array<{
    id: string;
    clientName: string | null;
    object: { id: string; name: string } | null;
    isUnplanned: boolean;
    visitedAt: string | null;
    visitReport: string | null;
    createdBy: { id: string; fullName: string };
  }>;
}
export interface PlanHistory {
  id: string;
  action: string;
  createdAt: string;
  actor: { fullName: string } | null;
}
export interface VisitPlanDay {
  plan: VisitPlan | null;
  capabilities: { canManage: boolean };
}
export const getVisitPlan = (
  date: string,
  managerUserId?: string,
): Promise<VisitPlanDay> =>
  fetcher(
    `/visit-plans?${new URLSearchParams({ date, ...(managerUserId ? { managerUserId } : {}) })}`,
  );
export const getPlanManagers = (): Promise<
  Array<{ id: string; fullName: string }>
> => fetcher("/visit-plans/managers");
export const getPlanHistory = (id: string): Promise<PlanHistory[]> =>
  fetcher(`/visit-plans/${id}/history`);
export const createVisitPlan = (payload: {
  managerUserId: string;
  planDate: string;
  reportDueAt?: string;
}): Promise<VisitPlan> =>
  fetcher("/visit-plans", { method: "POST", body: JSON.stringify(payload) });
export const addVisitPlanEntry = (
  id: string,
  payload: {
    expectedVersion: number;
    objectId?: string;
    clientName?: string;
    isUnplanned: boolean;
  },
): Promise<VisitPlan> =>
  fetcher(`/visit-plans/${id}/entries`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const recordPlanVisit = (
  id: string,
  entryId: string,
  payload: { expectedVersion: number; visited: boolean; visitReport?: string },
): Promise<VisitPlan> =>
  fetcher(`/visit-plans/${id}/entries/${entryId}/visit`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
export const savePlanReport = (
  id: string,
  payload: { expectedVersion: number; report: string; closeReport: boolean },
): Promise<VisitPlan> =>
  fetcher(`/visit-plans/${id}/report`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
