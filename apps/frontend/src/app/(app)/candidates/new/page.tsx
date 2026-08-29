'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { createCandidate } from '@/entities/candidate/api/candidate-client';
import type { CandidateType } from '@/entities/candidate/model/candidate.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { CANDIDATE_TYPE_OPTIONS } from '@/entities/candidate/lib/candidate-presentation';

export default function NewCandidatePage(): React.JSX.Element {
  const router = useRouter(); const { user } = useAuth();
  const [fullName, setFullName] = useState(''); const [phone, setPhone] = useState(''); const [comment, setComment] = useState(''); const [candidateType, setCandidateType] = useState<CandidateType>('regular'); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  if (!(user?.capabilities?.canManageCandidates ?? false)) return <><PageTitle title="Новый кандидат" /><div className="page-card">Недостаточно прав.</div></>;
  return <><PageTitle title="Новый кандидат" /><form className="page-card candidate-form" onSubmit={(event) => { event.preventDefault(); setSaving(true); setError(null); void createCandidate({ fullName, phone: phone || undefined, comment: comment || undefined, candidateType }).then((candidate) => router.push(`/candidates/${candidate.id}`)).catch(() => setError('Не удалось создать кандидата.')).finally(() => setSaving(false)); }}><label><span>ФИО</span><input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label><span>Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><SearchableSelect label="Тип" value={candidateType} options={CANDIDATE_TYPE_OPTIONS} clearable={false} onChange={(value) => setCandidateType(value as CandidateType)} /><label className="candidate-form__wide"><span>Комментарий</span><textarea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} /></label>{error ? <div className="inline-notice inline-notice--warning candidate-form__wide">{error}</div> : null}<div className="action-row candidate-form__wide"><button type="button" className="button-secondary" onClick={() => router.back()}>Отмена</button><button type="submit" disabled={saving || fullName.trim().length < 2}>{saving ? 'Сохраняем...' : 'Создать'}</button></div></form></>;
}
