import type { TaskItem } from '@/entities/task/model/task.types';

export type LeadershipObjectIssue =
  | 'no_responsible'
  | 'no_employees'
  | 'attendance_missing'
  | 'daily_report_missing';

export interface LeadershipAttentionItem {
  id: string;
  kind: 'object_issue' | 'task' | 'approval';
  badge: string;
  tone: 'danger' | 'warning' | 'neutral';
  title: string;
  subtitle: string;
  meta: string;
  objectIssueCode?: LeadershipObjectIssue;
  taskId?: string;
  approval?: { id: string; sourceEntityType: string; sourceEntityId: string };
}

export interface LeadershipDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  attention: {
    total: number;
    items: LeadershipAttentionItem[];
    objectIssues: {
      noResponsible: number;
      noEmployees: number;
      attendanceMissing: number;
      dailyReportMissing: number;
    };
    pendingApprovals: number;
    overdueTasks: number;
    awaitingConfirmationTasks: number;
  };
  today: {
    activeObjects: number;
    employeesOnObjects: number;
    objectsWithoutAttendanceMark: number;
    oneTimeOrders: number;
    decisionsRequired: number;
  };
  tasks: { totalRelevant: number; items: TaskItem[] };
  money: {
    available: boolean;
    submittedExpenses: number;
    closingRequestedAccounts: number;
    oneTimeOrderReceipts: { count: number; amount: number };
  };
  objects: {
    active: number;
    problematic: number;
    items: Array<{
      id: string;
      name: string;
      address: string;
      responsible: { id: string; login: string; fullName: string } | null;
      employeeCount: number;
      issues: LeadershipObjectIssue[];
    }>;
  };
  orders: {
    totalAccessible: number;
    items: Array<{
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      executionStartDate: string | null;
      linkedObject: { id: string; name: string } | null;
    }>;
  };
  people: {
    available: boolean;
    activeEmployees: number;
    employeesWithoutActiveObject: number;
    overdueCandidateSla: number | null;
    userAbsencesAvailable: boolean;
    userAbsencesToday: number | null;
  };
}

export type OperationManagerObjectIssue =
  | 'no_employees'
  | 'attendance_missing'
  | 'daily_report_missing';
export interface OperationManagerAttentionItem {
  id: string;
  kind: 'object_issue' | 'task';
  badge: string;
  tone: 'danger' | 'warning' | 'neutral';
  title: string;
  subtitle: string;
  meta: string;
  objectIssueCode?: OperationManagerObjectIssue;
  taskId?: string;
}
export interface OperationManagerDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  attention: {
    total: number;
    items: OperationManagerAttentionItem[];
    objectIssues: { noEmployees: number; attendanceMissing: number; dailyReportMissing: number };
    overdueTasks: number;
  };
  today: {
    activeObjects: number;
    employeesOnObjects: number;
    attendanceMissing: number;
    dailyReportMissing: number;
    myTasksToday: number;
  };
  objects: {
    active: number;
    problematic: number;
    items: Array<{ id: string; name: string; address: string; employeeCount: number; issues: OperationManagerObjectIssue[] }>;
  };
  tasks: { totalRelevant: number; items: TaskItem[] };
  orders: {
    totalAccessible: number;
    items: Array<{
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      executionStartDate: string | null;
      linkedObject: { id: string; name: string } | null;
    }>;
  };
}

export type ManagerScopeMode = 'regular' | 'one_time' | 'hybrid' | 'empty';
export type ManagerIssue =
  | 'object_no_employees'
  | 'object_attendance_missing'
  | 'object_daily_report_missing'
  | 'order_no_employees'
  | 'order_attendance_missing'
  | 'order_daily_report_missing';
export interface ManagerDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  scope: { mode: ManagerScopeMode; regularAssignments: number; oneTimeAssignments: number };
  today: {
    regularObjects: number;
    oneTimeOrders: number;
    employeesOnRegularObjects: number;
    regularAttendanceMissing: number;
    oneTimeAttendanceMissing: number;
    myTasksToday: number;
  };
  attention: {
    total: number;
    items: Array<{
      id: string;
      kind: 'scope_issue' | 'task';
      issueCode?: ManagerIssue;
      entityId?: string;
      badge: string;
      tone: 'danger' | 'warning' | 'neutral';
      title: string;
      subtitle: string;
      meta: string;
      taskId?: string;
    }>;
  };
  objects: {
    total: number;
    items: Array<{ id: string; name: string; address: string; employeeCount: number; issues: ManagerIssue[] }>;
  };
  orders: {
    total: number;
    today: number;
    items: Array<{
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      executionStartDate: string | null;
      executionEndDate: string | null;
      employeeCount: number;
      issues: ManagerIssue[];
    }>;
  };
  tasks: { totalRelevant: number; items: TaskItem[] };
}

export interface HrDashboardResponse {
  generatedAt: string;
  timeZone: 'Europe/Moscow';
  today: {
    activeEmployees: number;
    employeesWithoutObject: number;
    newCandidates: number;
    overdueCandidateSla: number;
    userAbsencesToday: number;
    myTasksToday: number;
  };
  attention: {
    total: number;
    items: Array<{
      id: string;
      kind: 'candidate_sla' | 'employee_without_object' | 'task';
      badge: string;
      tone: 'warning' | 'danger' | 'neutral';
      title: string;
      subtitle: string;
      meta: string;
      entityId?: string;
    }>;
  };
  candidates: {
    newCount: number;
    inProgressCount: number;
    overdueSlaCount: number;
    items: Array<{
      id: string;
      fullName: string;
      phone: string | null;
      status: string;
      candidateType: string;
      managerName: string | null;
      responseDueAt: string | null;
      overdue: boolean;
    }>;
  };
  employees: {
    activeCount: number;
    withoutObjectCount: number;
    items: Array<{ id: string; fullName: string; position: string | null; objectCount: number }>;
  };
  absences: {
    today: number;
    upcoming: Array<{
      id: string;
      userId: string;
      fullName: string;
      absenceType: string;
      startDate: string;
      endDate: string;
    }>;
  };
  tasks: { totalRelevant: number; items: TaskItem[] };
}
