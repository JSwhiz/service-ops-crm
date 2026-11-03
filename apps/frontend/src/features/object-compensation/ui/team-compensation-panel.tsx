'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cancelCompensationVersion, getObjectCompensation } from '@/entities/object/api/object-compensation-client';
import { getPayContours, getStaffingPositions } from '@/entities/object/api/object-scheduling-client';
import { listObjectCompensationRates } from '@/entities/object/api/object-operations-client';
import type { CompensationAdjustment, CompensationMutationResult, CompensationVersion, ObjectCompensation } from '@/entities/object/model/object-compensation.types';
import type { PayContour, StaffingPosition } from '@/entities/object/model/object-scheduling.types';
import { getErrorMessage } from '@/shared/lib/error-message';
import { formatUiDate } from '@/shared/lib/format-date';
import { Alert, Button, FactStrip, LoadingState, Surface } from '@/shared/ui/foundation';
import { ReasonDialog } from '@/shared/ui/overlays';
import { OverflowMenu } from '@/shared/ui/overflow-menu/overflow-menu';
import { moscowToday } from '@/features/object-scheduling/ui/schedule-preview';
import { CompensationVersionDialog, type CompensationLine } from './compensation-version-dialog';
import { TeamFundDialog } from './team-fund-dialog';
import styles from './team-compensation.module.css';
import { effectiveCompensationVersion } from '../model/compensation-state';
import { ExtraWorkCorrectionDialog } from './extra-work-correction-dialog';

export const compensationMoney = (value: number): string => `${value.toLocaleString('ru-RU')} ₽`;
export const adjustmentLabels: Record<string, string> = { extra_work: 'Допработа', extra_work_correction: 'Исправление допработы', shift_override: 'Изменение цены выхода', replacement: 'Оплата сменщику вместо основного', holiday_exception: 'Исключение оплаты праздника', confirm_shift: 'Подтверждение прошлого выхода', cancel_shift: 'Отмена прошлого выхода' };
const states: Record<string, string> = { pending: 'Ожидает согласования', applied: 'Применено', rejected: 'Отклонено', cancelled: 'Отменено' };

export function TeamCompensationPanel({ objectId, writable, financialRevision = 0 }: { objectId: string; writable: boolean; financialRevision?: number }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<{ objectId: string; value: ObjectCompensation } | null>(null);
  const data = snapshot?.objectId === objectId ? snapshot.value : null;
  const [positions, setPositions] = useState<StaffingPosition[]>([]);
  const [contours, setContours] = useState<PayContour[]>([]);
  const [lines, setLines] = useState<CompensationLine[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<CompensationLine | 'fund' | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CompensationVersion | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [correction, setCorrection] = useState<{ adjustment: CompensationAdjustment; cancel: boolean } | null>(null);
  const [correctionResult, setCorrectionResult] = useState<CompensationMutationResult | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const observedFinancialRevision = useRef(financialRevision);
  const correctionTriggers = useRef(new Map<string, React.MutableRefObject<HTMLButtonElement | null>>());
  const correctionTrigger = (id: string): React.MutableRefObject<HTMLButtonElement | null> => {
    let ref = correctionTriggers.current.get(id);
    if (!ref) { ref = { current: null }; correctionTriggers.current.set(id, ref); }
    return ref;
  };
  useEffect(() => {
    // Defer external refreshes until an open form closes; its draft stays mounted.
    if (editing || cancelTarget || correction || pending || observedFinancialRevision.current === financialRevision) return;
    observedFinancialRevision.current = financialRevision;
    setRefresh((value) => value + 1);
  }, [financialRevision, editing, cancelTarget, correction, pending]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setReferenceError(null);
    setSnapshot(null); setPositions([]); setContours([]); setLines([]);
    void Promise.allSettled([getObjectCompensation(objectId), getStaffingPositions(objectId), getPayContours(objectId), listObjectCompensationRates(objectId)]).then(([compensation, staffing, pay, rates]) => {
      if (!active) return;
      if (compensation.status === 'fulfilled') setSnapshot({ objectId, value: compensation.value });
      else setError(getErrorMessage(compensation.reason, 'Командная оплата недоступна.'));
      if (staffing.status === 'fulfilled') setPositions(staffing.value.positions);
      if (pay.status === 'fulfilled') setContours(pay.value.contours);
      const failed = [staffing, pay, rates].find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') setReferenceError(getErrorMessage(failed.reason, 'Не удалось загрузить позиции или условия. Редакторы недоступны до обновления.'));
      setLines([
        { key: 'defaults', name: 'Базовые условия объекта', scope: 'defaults', scopeId: objectId },
        ...(pay.status === 'fulfilled' ? pay.value.contours.filter((c) => c.isActive).map((c) => ({ key: c.id, name: c.name, scope: 'contour' as const, scopeId: c.id })) : []),
        ...(rates.status === 'fulfilled' ? rates.value.filter((r) => r.isActive).map((r) => ({ key: r.id, name: r.name, scope: 'rate' as const, scopeId: r.id })) : []),
      ]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [objectId, refresh]);
  useEffect(() => { setEditing(null); setCancelTarget(null); setCorrection(null); setCorrectionResult(null); setReason(''); setCancelError(null); setSuccess(null); }, [objectId]);
  const saved = (): void => { setEditing(null); setSuccess('Условия сохранены. Прежние начисления не изменены.'); setRefresh((v) => v + 1); };
  const currentFund = data?.teamFunds.filter((f) => f.effectiveFrom <= moscowToday()).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const canEdit = writable && data?.capabilities.manageRates && !loading && !error && !referenceError;
  const canEditFund = writable && data?.capabilities.manageTeamFund && !loading && !error && !referenceError;
  const positionName = (id: string, date: string): string => positions.find((p) => p.id === id)?.revisions.filter((r) => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0]?.name ?? 'Название позиции недоступно';
  const lineName = (v: CompensationVersion): string => lines.find((l) => l.scope === v.scope && l.scopeId === v.scopeId)?.name ?? 'Сохранённое условие оплаты';
  return <Surface padding="md" as="section" id="compensation-versions"><div className={styles.content}>
    <div className="ui-section-header"><h3 className="ui-section-title" ref={titleRef} tabIndex={-1}>Фонд команды и условия оплаты</h3><Button disabled={loading || !!editing || !!cancelTarget || !!correction} onClick={() => setRefresh((v) => v + 1)}>Обновить</Button></div>
    <p className="ui-text-muted">Фонд задаётся на команду и распределяется явно по позициям и условиям. Численность и группы ротации не увеличивают фонд; незакрытые выходы не распределяются остальным. Начисление и фактическая выплата учитываются отдельно.</p>
    {loading ? <LoadingState label="Загрузка командной оплаты" /> : null}
    {error ? <Alert tone="danger">{error} Новые действия доступны после успешного обновления.</Alert> : null}
    {referenceError ? <Alert tone="warning">{referenceError}</Alert> : null}
    {success ? <Alert tone="success" role="status">{success}</Alert> : null}
    {correctionResult ? <Alert tone={correctionResult.status === 'applied' ? 'success' : 'info'} role="status">{correctionResult.status === 'pending' ? 'Исправление допработы ожидает согласования. Прежняя сумма остаётся действующей.' : correctionResult.status === 'applied' ? 'Исправление допработы применено. Основная оплата выхода не изменена.' : correctionResult.status === 'rejected' ? 'Исправление допработы отклонено.' : 'Запрос исправления допработы отменён.'} {correctionResult.approvalRequestId ? <a href={`/approvals?${new URLSearchParams({ sourceEntityType: 'object_compensation_adjustment', sourceEntityId: correctionResult.adjustmentId })}`}>Открыть согласование</a> : null}</Alert> : null}
    {data ? <>
      <FactStrip items={[{ label: 'Фонд команды за месяц', value: currentFund ? compensationMoney(currentFund.monthlyAmount) : 'Не задан' }, { label: 'Действует с', value: currentFund ? formatUiDate(currentFund.effectiveFrom) : '—' }]} />
      {canEditFund ? <div><Button onClick={() => { setSuccess(null); setEditing('fund'); }}>Задать фонд и распределение</Button></div> : null}
      <details><summary>План и история распределения фонда ({data.teamFunds.length})</summary>
        {data.teamFunds.length ? data.teamFunds.map((f) => <section key={f.id} className={styles.section}>
          <strong>{formatUiDate(f.effectiveFrom)} · {compensationMoney(f.monthlyAmount)} на команду{f.effectiveFrom > moscowToday() ? ' · Будущая версия' : currentFund?.id === f.id ? ' · Действует' : ' · История'}</strong>
          {f.allocations.map((a) => <div key={`${a.positionId}:${a.contourId}`}>{positionName(a.positionId, f.effectiveFrom)} · {contours.find((c) => c.id === a.contourId)?.name ?? 'Название условия недоступно'}: {compensationMoney(a.monthlyAmount)} на позицию</div>)}
          <p>Основание: {f.reason}</p>
          <p className="ui-text-muted">Автор: {f.createdBy?.fullName ?? 'Имя недоступно'}</p>
        </section>) : <p>Распределение ещё не задано.</p>}
      </details>
      <section className={styles.section} aria-label="Датированные условия">
        <h4 className="ui-section-title">Условия оплаты с датой начала</h4>
        <p className="ui-text-muted">Условия выбираются по дате выхода. Новые условия не меняют уже сохранённые суммы.</p>
        {lines.map((line) => {
          const current = effectiveCompensationVersion(data.versions, line.scope, line.scopeId, moscowToday());
          return <div key={`${line.scope}:${line.key}`} className={styles.section}><div className="ui-section-header"><strong>{line.name}</strong>{canEdit ? <Button onClick={() => { setSuccess(null); setEditing(line); }}>Изменить с даты</Button> : null}</div>
            <p>{current ? `${current.terms.ratePolicyType === 'monthly_fixed' ? 'За месяц' : 'За выход'}: ${compensationMoney(current.terms.baseAmount)} · с ${formatUiDate(current.effectiveFrom)}` : 'Условия с датой начала пока не заданы.'}</p>
          </div>;
        })}
        <details><summary>История и будущие условия ({data.versions.length})</summary>{data.versions.map((v) => <div key={v.id} className={styles.section}>
          <strong>{lineName(v)} · с {formatUiDate(v.effectiveFrom)} · {v.cancelledAt ? 'Отменена' : v.effectiveFrom > moscowToday() ? 'Будущая версия' : 'Сохранённая версия'}</strong>
          <p>{v.terms.ratePolicyType === 'monthly_fixed' ? 'За месяц' : 'За выход'}: {compensationMoney(v.terms.baseAmount)}. Лето: {v.terms.summerAmount == null ? 'базовая сумма' : compensationMoney(v.terms.summerAmount)}. Зима: {v.terms.winterAmount == null ? 'базовая сумма' : compensationMoney(v.terms.winterAmount)}. Праздники: {v.terms.paidHolidays === false ? 'не оплачиваются по этим условиям' : 'оплачиваются без отметки присутствия'}.</p>
          {v.cancelReason ? <p>Причина отмены: {v.cancelReason}</p> : null}
          <p className="ui-text-muted">Автор: {v.createdBy?.fullName ?? 'Имя недоступно'}</p>
          {canEdit && !v.cancelledAt && v.effectiveFrom > moscowToday() ? <OverflowMenu triggerLabel={`Действия с будущими условиями · ${lineName(v)} · ${formatUiDate(v.effectiveFrom)}`} items={[{ key: 'cancel', label: 'Отменить будущую версию', tone: 'danger', onSelect: () => { setCancelTarget(v); setReason(''); setCancelError(null); } }]} /> : null}
        </div>)}</details>
      </section>
      <details><summary>Изменения начислений · последние {data.adjustments.length}</summary>
        <p>Прошлые суммы меняются после согласования другим пользователем руководящего круга. До решения сохраняется прежнее начисление.</p>
        {data.adjustments.map((a) => { const correctionPending = data.adjustments.some((item) => item.kind === 'extra_work_correction' && item.status === 'pending' && item.payload.sourceAdjustmentId === a.id); return <div key={a.id} className={styles.section}>
          <strong>{adjustmentLabels[a.kind] ?? 'Изменение начисления'} · {formatUiDate(a.operationDate)} · {states[a.status] ?? 'Неизвестное состояние'}</strong>
          <p>{a.reason}</p>
          <p>Автор: {a.createdBy?.fullName ?? 'Имя недоступно'}{a.appliedBy ? ` · Применил: ${a.appliedBy.fullName}` : ''}</p>
          {a.beforeAmount != null || a.afterAmount != null ? <p>Было: {a.beforeAmount == null ? 'Недоступно' : compensationMoney(a.beforeAmount)} · Стало: {a.afterAmount == null ? 'Недоступно' : compensationMoney(a.afterAmount)} · Разница: {a.difference == null ? 'Недоступно' : compensationMoney(a.difference)}</p> : null}
          {a.kind === 'extra_work' && a.currentAmount != null ? <p>Сейчас начислено за эту допработу: {compensationMoney(a.currentAmount)}.</p> : null}
          {correctionPending ? <p role="status">Исправление этой допработы ожидает согласования.</p> : null}
          {a.kind === 'extra_work' && a.status === 'applied' && writable && data.capabilities.requestExtraWork ? <OverflowMenu triggerRef={correctionTrigger(a.id)} triggerLabel={`Действия с допработой · ${formatUiDate(a.operationDate)} · ${a.reason}`} items={[
            { key: 'correct', label: 'Исправить начисление за допработу', disabled: loading || !!error || correctionPending, disabledReason: correctionPending ? 'Дождитесь решения по текущему исправлению.' : undefined, onSelect: () => { setCorrectionResult(null); setSuccess(null); setCorrection({ adjustment: a, cancel: false }); } },
            { key: 'cancel', label: 'Отменить начисление за допработу', tone: 'danger', disabled: loading || !!error || correctionPending || a.currentAmount === 0, disabledReason: correctionPending ? 'Дождитесь решения по текущему исправлению.' : a.currentAmount === 0 ? 'Допработа уже отменена.' : undefined, onSelect: () => { setCorrectionResult(null); setSuccess(null); setCorrection({ adjustment: a, cancel: true }); } },
          ]} /> : null}
          <a href={`/approvals?${new URLSearchParams({ sourceEntityType: 'object_compensation_adjustment', sourceEntityId: a.id })}`}>Решение и история согласования</a>
        </div>; })}
      </details>
    </> : null}
    {editing === 'fund' && data && canEditFund ? <TeamFundDialog objectId={objectId} funds={data.teamFunds} versions={data.versions} positions={positions} contours={contours} onClose={() => setEditing(null)} onSaved={saved} /> : editing && editing !== 'fund' && data && canEdit ? <CompensationVersionDialog objectId={objectId} line={editing} versions={data.versions} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    {correction && data && writable && data.capabilities.requestExtraWork ? <ExtraWorkCorrectionDialog key={`${objectId}:${correction.adjustment.id}:${correction.cancel}`} objectId={objectId} adjustment={correction.adjustment} cancel={correction.cancel} returnFocusRef={correctionTrigger(correction.adjustment.id)} onClose={() => setCorrection(null)} onSaved={(result) => {
      setCorrection(null); setCorrectionResult(result); setRefresh((value) => value + 1);
      queueMicrotask(() => titleRef.current?.focus({ preventScroll: true }));
    }} /> : null}
    <ReasonDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && !pending) setCancelTarget(null); }} title="Отменить будущие условия?" description="Отмена сохранится в истории. Прошлые и текущие условия останутся прежними." reason={reason} onReasonChange={setReason} reasonRequired pending={pending} error={cancelError} confirmLabel="Отменить условия" onConfirm={async (value) => {
      if (!cancelTarget || pending) return;
      setPending(true); setCancelError(null);
      try { await cancelCompensationVersion(objectId, cancelTarget.id, { expectedVersion: cancelTarget.version, reason: value }); setCancelTarget(null); setRefresh((v) => v + 1); }
      catch (caught) { setCancelError(getErrorMessage(caught, 'Не удалось отменить версию. Обновите список при конфликте.')); }
      finally { setPending(false); }
    }} />
  </div></Surface>;
}
