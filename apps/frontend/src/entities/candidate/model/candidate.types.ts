export type CandidateType = 'regular' | 'reserve';
export type CandidateStatus = 'new' | 'in_progress' | 'accepted' | 'rejected';
export type CandidateSlaState =
  | 'unassigned'
  | 'awaiting_response'
  | 'overdue'
  | 'responded';
export type CandidateArchiveState = 'active' | 'archived' | 'all';
export type CandidateEmployeeType = 'regular' | 'one_time' | 'substitution';
export interface CandidateAssignmentInput {
  managerUserId: string;
  objectId?: string | null;
}

export interface CandidateUserSummary {
  id: string;
  login: string;
  fullName: string;
}
export interface CandidateObjectSummary {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
}
export interface CandidateAssignment {
  id: string;
  object: CandidateObjectSummary | null;
  manager: CandidateUserSummary;
  assignedBy: CandidateUserSummary;
  assignedAt: string;
  responseDueAt: string;
  firstRespondedAt: string | null;
  reminderSentAt: string | null;
  endedAt: string | null;
  endedBy: CandidateUserSummary | null;
}
export interface CandidateResponse {
  id: string;
  assignmentId: string | null;
  author: CandidateUserSummary;
  text: string;
  createdAt: string;
}
export interface CandidateListItem {
  id: string;
  fullName: string;
  phone: string | null;
  phones: string[];
  employeeId: string | null;
  candidateType: CandidateType;
  status: CandidateStatus;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
  object: CandidateObjectSummary | null;
  currentAssignment: CandidateAssignment | null;
  currentAssignments: CandidateAssignment[];
  latestFeedback: CandidateResponse | null;
  slaState: CandidateSlaState;
}
export interface CandidateListResponse {
  items: CandidateListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface CandidateCard extends CandidateListItem {
  comment: string | null;
  createdBy: CandidateUserSummary;
  createdAt: string;
  assignments: CandidateAssignment[];
  responses: CandidateResponse[];
  capabilities: {
    canManage: boolean;
    canRespond: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canConvert: boolean;
    canViewEmployee: boolean;
  };
}
