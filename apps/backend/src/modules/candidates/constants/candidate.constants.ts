export const CANDIDATE_TYPES = ['regular', 'reserve'] as const;
export const CANDIDATE_STATUSES = ['new', 'in_progress', 'accepted', 'rejected'] as const;
export const CANDIDATE_SLA_STATES = ['unassigned', 'awaiting_response', 'overdue', 'responded'] as const;
export const CANDIDATE_ARCHIVE_STATES = ['active', 'archived', 'all'] as const;
export const CANDIDATE_MANAGER_ROLE_CODES = ['manager', 'operation_manager'] as const;
export const CANDIDATE_RESPONSE_SLA_MS = 2 * 60 * 60 * 1000;
