export interface CandidateUserSummaryDto {
  id: string;
  login: string;
  fullName: string;
}

export interface CandidateAssignmentResponseDto {
  id: string;
  manager: CandidateUserSummaryDto;
  assignedBy: CandidateUserSummaryDto;
  assignedAt: string;
  responseDueAt: string;
  firstRespondedAt: string | null;
  reminderSentAt: string | null;
  endedAt: string | null;
  endedBy: CandidateUserSummaryDto | null;
}

export interface CandidateResponseItemDto {
  id: string;
  assignmentId: string | null;
  author: CandidateUserSummaryDto;
  text: string;
  createdAt: string;
}

export interface CandidateListItemDto {
  id: string;
  fullName: string;
  phone: string | null;
  candidateType: string;
  status: string;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
  currentAssignment: CandidateAssignmentResponseDto | null;
  slaState: string;
}

export class CandidateListResponseDto {
  items!: CandidateListItemDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export interface CandidateCardResponseDto extends CandidateListItemDto {
  comment: string | null;
  createdBy: CandidateUserSummaryDto;
  createdAt: string;
  assignments: CandidateAssignmentResponseDto[];
  responses: CandidateResponseItemDto[];
  capabilities: {
    canManage: boolean;
    canRespond: boolean;
    canArchive: boolean;
    canRestore: boolean;
  };
}
