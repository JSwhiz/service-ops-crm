import type { CandidateSlaState, CandidateStatus, CandidateType } from '../model/candidate.types';

export const CANDIDATE_TYPE_OPTIONS = [{ value: 'regular', label: 'Обычный' }, { value: 'reserve', label: 'Резерв' }];
export const CANDIDATE_STATUS_OPTIONS = [{ value: 'new', label: 'Новый' }, { value: 'in_progress', label: 'В работе' }, { value: 'accepted', label: 'Принят' }, { value: 'rejected', label: 'Отклонён' }];
export const CANDIDATE_SLA_OPTIONS = [{ value: 'unassigned', label: 'Не назначен' }, { value: 'awaiting_response', label: 'Ожидает ответа' }, { value: 'overdue', label: 'Просрочено' }, { value: 'responded', label: 'Ответ получен' }];

export function candidateTypeLabel(value: CandidateType): string { return CANDIDATE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value; }
export function candidateStatusLabel(value: CandidateStatus): string { return CANDIDATE_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value; }
export function candidateSlaLabel(state: CandidateSlaState, dueAt?: string | null): string {
  if (state !== 'awaiting_response' || !dueAt) return CANDIDATE_SLA_OPTIONS.find((item) => item.value === state)?.label ?? state;
  const minutes = Math.max(0, Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60_000));
  return `Ожидает ответа · ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
