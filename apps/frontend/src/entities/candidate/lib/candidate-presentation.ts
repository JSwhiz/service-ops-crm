import type {
  CandidateAssignment,
  CandidateListItem,
  CandidateSlaState,
  CandidateStatus,
  CandidateType,
} from '../model/candidate.types';

export function candidatePhones(
  candidate: Pick<CandidateListItem, 'phones' | 'phone'>,
): string[] {
  return candidate.phones ?? (candidate.phone ? [candidate.phone] : []);
}

export function candidateActiveAssignments(
  candidate: Pick<
    CandidateListItem,
    'currentAssignments' | 'currentAssignment'
  >,
): CandidateAssignment[] {
  return (
    candidate.currentAssignments ??
    (candidate.currentAssignment ? [candidate.currentAssignment] : [])
  );
}

export function candidateAssignmentSla(
  assignment: CandidateAssignment,
): CandidateSlaState {
  if (assignment.firstRespondedAt) return 'responded';
  return new Date(assignment.responseDueAt).getTime() <= Date.now()
    ? 'overdue'
    : 'awaiting_response';
}

export const CANDIDATE_EMPLOYEE_TYPE_OPTIONS = [
  { value: 'regular', label: 'Постоянный' },
  { value: 'one_time', label: 'Разовый' },
  { value: 'substitution', label: 'Подменный' },
];

export const CANDIDATE_TYPE_OPTIONS = [
  { value: 'regular', label: 'Обычный' },
  { value: 'reserve', label: 'Резерв' },
];
export const CANDIDATE_STATUS_OPTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'accepted', label: 'Принят' },
  { value: 'rejected', label: 'Отклонён' },
];
export const CANDIDATE_SLA_OPTIONS = [
  { value: 'unassigned', label: 'Не назначен' },
  { value: 'awaiting_response', label: 'Ожидает ответа' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'responded', label: 'Ответ получен' },
];

export function candidateTypeLabel(value: CandidateType): string {
  return (
    CANDIDATE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value
  );
}
export function candidateStatusLabel(value: CandidateStatus): string {
  return (
    CANDIDATE_STATUS_OPTIONS.find((item) => item.value === value)?.label ??
    value
  );
}
export function candidateSlaLabel(
  state: CandidateSlaState,
  dueAt?: string | null,
): string {
  if (state !== 'awaiting_response' || !dueAt)
    return (
      CANDIDATE_SLA_OPTIONS.find((item) => item.value === state)?.label ?? state
    );
  const minutes = Math.max(
    0,
    Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60_000),
  );
  return `Ожидает ответа · ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
