import type { AttachedFile } from '@/entities/file/model/file.types';

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
  isAssignedToObject: boolean;
  availability: {
    isUnavailable: boolean;
    availabilityMode: string | null;
    startDate: string | null;
    endDate: string | null;
    comment: string | null;
  };
  activeSubstitutions: Array<{
    id: string;
    role: 'primary' | 'replacement';
    counterpartEmployeeId: string;
    counterpartEmployeeName: string;
    startDate: string;
    endDate: string | null;
    status: string;
    reason: string;
    comment: string | null;
  }>;
}

export interface ObjectArrivalPhoto {
  id: string;
  objectId: string;
  operationDate: string;
  photoUrl: string | null;
  photoType: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments: AttachedFile[];
}

export interface ObjectDailyReport {
  id: string;
  objectId: string;
  reportDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments: AttachedFile[];
}

export interface ObjectComment {
  id: string;
  objectId: string;
  content: string;
  commentType: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments: AttachedFile[];
}

export interface LinkedOneTimeOrderProjection {
  id: string;
  title: string;
  status: string;
  executionDate: string | null;
  agreedSum: number | null;
  canOpenOrderCard: boolean;
  managers: Array<{
    userId: string;
    fullName: string;
    roleCode: string;
  }>;
  summary: {
    commentsCount: number;
    reportsCount: number;
    photosCount: number;
    filesCount: number;
    tasksCount: number;
  };
}

export interface ObjectFeedItem {
  type: 'arrival_photo' | 'daily_report' | 'comment';
  id: string;
  occurredAt: string;
  title: string;
  description: string;
  author: {
    id: string;
    login: string;
    fullName: string;
  };
}
