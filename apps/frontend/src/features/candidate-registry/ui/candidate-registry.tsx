'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

import { listCandidateManagers, listCandidates } from '@/entities/candidate/api/candidate-client';
import { CANDIDATE_SLA_OPTIONS, CANDIDATE_STATUS_OPTIONS, CANDIDATE_TYPE_OPTIONS, candidateSlaLabel, candidateStatusLabel, candidateTypeLabel } from '@/entities/candidate/lib/candidate-presentation';
import type { CandidateArchiveState, CandidateListResponse, CandidateSlaState, CandidateStatus, CandidateType } from '@/entities/candidate/model/candidate.types';
import { useAuth } from '@/shared/auth/use-auth';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';

const EMPTY: CandidateListResponse = { items: [], page: 1, limit: 25, total: 0, totalPages: 0 };

export function CandidateRegistry({ fixedType }: { fixedType?: CandidateType }): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sequenceRef = useRef(0);
  const q = searchParams.get('q') ?? '';
  const type = fixedType ?? (searchParams.get('candidateType') as CandidateType | null) ?? '';
  const status = (searchParams.get('status') as CandidateStatus | null) ?? '';
  const managerUserId = searchParams.get('managerUserId') ?? '';
  const slaState = (searchParams.get('slaState') as CandidateSlaState | null) ?? '';
  const archiveState = fixedType ? 'active' : ((searchParams.get('archiveState') as CandidateArchiveState | null) ?? 'active');
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const [search, setSearch] = useState(q);
  const [manager, setManager] = useState<SearchableSelectOption | null>(null);
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const canAccess = user?.capabilities?.canAccessCandidates ?? false;
  const canManage = user?.capabilities?.canManageCandidates ?? false;

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) { if (value) next.set(key, value); else next.delete(key); }
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  useEffect(() => setSearch(q), [q]);
  useEffect(() => { const timer = window.setTimeout(() => { const value = search.trim(); if (value !== q) replaceQuery({ q: value || null, page: null }); }, 300); return () => window.clearTimeout(timer); }, [q, search]);
  useEffect(() => {
    if (!managerUserId) { setManager(null); return; }
    let active = true;
    void listCandidateManagers({ selectedId: managerUserId }).then(([item]) => { if (active) setManager(item ? { value: item.id, label: item.fullName || item.login, searchText: item.login } : null); }).catch(() => { if (active) setManager(null); });
    return () => { active = false; };
  }, [managerUserId]);
  useEffect(() => {
    if (!canAccess) { setLoading(false); return; }
    const sequence = ++sequenceRef.current;
    setLoading(true); setError(null);
    void listCandidates({ q: q || undefined, candidateType: type || undefined, status: status || undefined, managerUserId: managerUserId || undefined, slaState: slaState || undefined, archiveState, page, limit: 25 })
      .then((next) => { if (sequence === sequenceRef.current) setResult(next); })
      .catch(() => { if (sequence === sequenceRef.current) setError('Не удалось загрузить кандидатов.'); })
      .finally(() => { if (sequence === sequenceRef.current) setLoading(false); });
  }, [archiveState, canAccess, managerUserId, page, q, slaState, status, type]);
  useEffect(() => {
    if (!result.items.some((item) => item.slaState === 'awaiting_response')) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [result.items]);

  if (!canAccess) return <div className="page-card">У вас нет доступа к кандидатам.</div>;
  return <div className="candidate-registry page-stack">
    <section className="page-card section-header"><div><div className="section-title">{fixedType === 'reserve' ? 'Кандидаты резерва' : 'Реестр кандидатов'}</div><div className="page-muted">Найдено: {result.total}</div></div>{canManage && !fixedType ? <Link className="button-link" href="/candidates/new">Добавить кандидата</Link> : null}</section>
    <section className="page-card candidate-filters">
      <label><span className="detail-label">Поиск</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ФИО или телефон" /></label>
      {!fixedType ? <SearchableSelect label="Тип" value={type} options={CANDIDATE_TYPE_OPTIONS} placeholder="Все типы" onChange={(value) => replaceQuery({ candidateType: value || null, page: null })} /> : null}
      <SearchableSelect label="Статус" value={status} options={CANDIDATE_STATUS_OPTIONS} placeholder="Все статусы" onChange={(value) => replaceQuery({ status: value || null, page: null })} />
      <SearchableSelect label="Менеджер" value={managerUserId} selectedOption={manager} options={[]} placeholder="Все менеджеры" onChange={(value) => replaceQuery({ managerUserId: value || null, page: null })} asyncSearch={async (value) => (await listCandidateManagers({ q: value })).map((item) => ({ value: item.id, label: item.fullName || item.login, searchText: item.login }))} />
      <SearchableSelect label="SLA" value={slaState} options={CANDIDATE_SLA_OPTIONS} placeholder="Любое состояние" onChange={(value) => replaceQuery({ slaState: value || null, page: null })} />
      {!fixedType ? <SearchableSelect label="Архив" value={archiveState} clearable={false} options={[{ value: 'active', label: 'Активные' }, { value: 'archived', label: 'Архив' }, { value: 'all', label: 'Все' }]} onChange={(value) => replaceQuery({ archiveState: value === 'active' ? null : value, page: null })} /> : null}
      <button type="button" className="button-secondary" onClick={() => { setSearch(''); router.replace(pathname, { scroll: false }); }}>Сбросить</button>
    </section>
    {loading ? <div className="page-card">Загрузка...</div> : error ? <div className="page-card inline-notice inline-notice--warning">{error}</div> : result.items.length === 0 ? <div className="page-card">Кандидаты не найдены.</div> : <>
      <div className="page-card candidate-table-wrap"><table className="data-table candidate-table"><thead><tr><th>ФИО</th><th>Телефон</th><th>Тип</th><th>Статус</th><th>Менеджер</th><th>SLA</th><th>Изменён</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.id}><td><Link href={`/candidates/${item.id}`}>{item.fullName}</Link></td><td>{item.phone ?? '—'}</td><td>{candidateTypeLabel(item.candidateType)}</td><td>{candidateStatusLabel(item.status)}</td><td>{item.currentAssignment?.manager.fullName ?? 'Не назначен'}</td><td><span className={`candidate-sla candidate-sla--${item.slaState}`}>{candidateSlaLabel(item.slaState, item.currentAssignment?.responseDueAt)}</span></td><td>{new Date(item.updatedAt).toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>
      <div className="candidate-mobile-list">{result.items.map((item) => <Link key={item.id} href={`/candidates/${item.id}`} className="page-card candidate-mobile-card"><div className="section-header"><strong>{item.fullName}</strong><span>{candidateStatusLabel(item.status)}</span></div><div>{item.phone ?? 'Телефон не указан'} · {candidateTypeLabel(item.candidateType)}</div><div>{item.currentAssignment?.manager.fullName ?? 'Менеджер не назначен'}</div><span className={`candidate-sla candidate-sla--${item.slaState}`}>{candidateSlaLabel(item.slaState, item.currentAssignment?.responseDueAt)}</span></Link>)}</div>
    </>}
    {result.totalPages > 1 ? <div className="page-card pagination-row"><button type="button" disabled={page <= 1} onClick={() => replaceQuery({ page: String(page - 1) })}>Назад</button><span>Страница {page} из {result.totalPages}</span><button type="button" disabled={page >= result.totalPages} onClick={() => replaceQuery({ page: String(page + 1) })}>Далее</button></div> : null}
  </div>;
}
