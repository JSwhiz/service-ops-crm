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
  approval?: {
    id: string;
    sourceEntityType: string;
    sourceEntityId: string;
  };
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
  tasks: {
    totalRelevant: number;
    items: TaskItem[];
  };
  money: {
    available: boolean;
    submittedExpenses: number;
    closingRequestedAccounts: number;
    oneTimeOrderReceipts: {
      count: number;
      amount: number;
    };
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
