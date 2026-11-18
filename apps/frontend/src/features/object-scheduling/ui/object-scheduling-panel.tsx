'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { createStaffingPosition, getPayContours, getStaffingPositions, previewSchedule, saveStaffingPosition } from '@/entities/object/api/object-scheduling-client';
import { searchEmployeeDirectory } from '@/entities/object/api/object-operations-client';
import type { PayContour, PositionsResponse, StaffingPosition } from '@/entities/object/model/object-scheduling.types';
import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button, EmptyState, LoadingState, Surface } from '@/shared/ui/foundation';
import { useConfirm } from '@/shared/ui/overlays';
import { getErrorMessage } from '@/shared/lib/error-message';
import { newPositionDraft, positionPayload, restrictedPositionChanges, revisionDraft, type PositionDraft } from '../model/schedule-draft';
import { PositionEditor } from './position-editor';
import { SchedulePreviewPanel } from './schedule-preview';
import { PayContoursPanel } from './pay-contours-panel';
import styles from './object-scheduling.module.css';
import { AccessSnapshotBoundary, AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';


export function ObjectSchedulingPanel({ objectId, canSelectEmployees, employees, onChanged, onSavedWithoutAccess }: {
  objectId: string; canSelectEmployees: boolean; employees: ObjectEmployeeOption[]; onChanged?: () => void;
  onSavedWithoutAccess?: () => void;
}): React.JSX.Element {
  const accessRevision = useAccessRevision();
  const { capabilitiesRefreshError } = useAuth();
  const ancestorBlocked = useContext(AccessSnapshotBlockedContext);
  const [loadedSnapshot, setLoadedSnapshot] = useState<string | null>(null);
  const snapshotKey = `${objectId}:${accessRevision}`;
  const latest = useRef({ snapshotKey, capabilitiesRefreshError });
  latest.current = { snapshotKey, capabilitiesRefreshError };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [data, setData] = useState<PositionsResponse | null>(null);
  const [contours, setContours] = useState<PayContour[]>([]);
  const [contourError, setContourError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [readDenied, setReadDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffingPosition | null>(null);
  const [draft, setDraft] = useState<PositionDraft | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<PositionDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();
  const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
  draft?.groups.forEach((group) => group.assignments.forEach((assignment) => names.set(assignment.employeeId, assignment.employeeName)));
  useEffect(() => {
    let active = true;
    const requestKey = snapshotKey;
    setLoading(true); setError(null); setContourError(null);
    if (capabilitiesRefreshError) return () => { active = false; };
    void getStaffingPositions(objectId).then((response) => { if (active && latest.current.snapshotKey === requestKey && !latest.current.capabilitiesRefreshError) { setData(response); setLoadedSnapshot(requestKey); setReadDenied(false); } })
      .catch((caught) => { if (active) { setReadDenied(true); setError(caught instanceof ApiError && [403, 404].includes(caught.statusCode) ? 'Доступ к графикам объекта не подтверждён. Черновик сохранён.' : getErrorMessage(caught, 'Не удалось загрузить позиции.')); } })
      .finally(() => { if (active) setLoading(false); });
    void getPayContours(objectId).then((response) => { if (active && latest.current.snapshotKey === requestKey && !latest.current.capabilitiesRefreshError) setContours(response.contours); })
      .catch((caught) => { if (active) setContourError(getErrorMessage(caught, 'Не удалось загрузить контуры оплаты.')); });
    return () => { active = false; };
  }, [objectId, snapshotKey, capabilitiesRefreshError]);
  const accessBlocked = ancestorBlocked || loading || readDenied || !!capabilitiesRefreshError || loadedSnapshot !== snapshotKey;
  const canManagePositions = !accessBlocked && data?.capabilities.managePositions === true;
  const restrictedDraftMessage = (capabilities: PositionsResponse['capabilities']): string | null => {
    if (!draft || !draftBaseline) return null;
    const changes = restrictedPositionChanges(draft, draftBaseline);
    if (changes.assignments && (!canSelectEmployees || !capabilities.manageAssignments)) return 'Право изменять состав недоступно. Изменения назначений сохранены в черновике; отправка заблокирована до возврата права.';
    if (changes.payConditions && !capabilities.selectPayConditions) return 'Право выбирать условия оплаты недоступно. Выбранные условия сохранены в черновике; отправка заблокирована до возврата права.';
    return null;
  };
  const draftAccessMessage = data ? restrictedDraftMessage(data.capabilities) : null;
  const refresh = async (): Promise<void> => {
    setError(null);
    try {
      const requestKey = snapshotKey;
      const response = await getStaffingPositions(objectId);
      if (latest.current.snapshotKey === requestKey && !latest.current.capabilitiesRefreshError) { setData(response); setLoadedSnapshot(requestKey); setReadDenied(false); }
    }
    catch (caught) { if (caught instanceof ApiError && [403, 404].includes(caught.statusCode)) setReadDenied(true); setError(getErrorMessage(caught, 'Не удалось обновить позиции.')); }
  };
  const start = (position: StaffingPosition | null): void => {
    if (!canManagePositions) return;
    const revision = position?.revisions.at(-1);
    const nextDraft = position && revision ? revisionDraft(position.clientKey, revision, names) : newPositionDraft();
    setEditing(position); setDraft(nextDraft); setDraftBaseline(nextDraft);
    setConflict(false); setError(null); setSuccess(null);
  };
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || !draft || conflict) return;
    if (!canManagePositions) { setError('Право изменения графика недоступно. Черновик сохранён.'); return; }
    if (draftAccessMessage) { setError(draftAccessMessage); return; }
    const generation = getAccessGeneration();
    const session = getAccessSessionGeneration();
    const requestKey = snapshotKey;
    setPending(true); setError(null); setSuccess(null);
    try {
      const fresh = await getStaffingPositions(objectId);
      if (!isAccessGenerationCurrent(generation) || latest.current.snapshotKey !== requestKey || latest.current.capabilitiesRefreshError) return;
      setData(fresh);
      if (!fresh.capabilities.managePositions) throw new Error('Право изменения графика отозвано. Черновик сохранён.');
      const freshDraftAccessMessage = restrictedDraftMessage(fresh.capabilities);
      if (freshDraftAccessMessage) throw new Error(freshDraftAccessMessage);
      const { clientKey, ...fields } = positionPayload(draft);
      const saved = editing
        ? await saveStaffingPosition(objectId, editing.id, { ...fields, expectedVersion: editing.version })
        : await createStaffingPosition(objectId, { ...fields, clientKey });
      if (getAccessSessionGeneration() !== session) return;
      if (isSavedWithoutAccess(saved)) { onSavedWithoutAccess?.(); return; }
      if (!mounted.current || !isAccessGenerationCurrent(generation) || latest.current.snapshotKey !== requestKey) {
        onSavedWithoutAccess?.(); return;
      }
      setData((previous) => previous ? { ...previous, positions: [...previous.positions.filter((position) => position.id !== saved.id), saved] } : previous);
      setDraft(null); setEditing(null); setSuccess('Позиция и график сохранены.'); onChanged?.();
    } catch (caught) {
      if (caught instanceof ApiError && [403, 404].includes(caught.statusCode)) setReadDenied(true);
      setConflict(caught instanceof ApiError && caught.statusCode === 409 && caught.code === 'VERSION_CONFLICT');
      setError(caught instanceof ApiError && [403, 404].includes(caught.statusCode) ? 'Доступ к графикам объекта не подтверждён. Черновик сохранён.' : getErrorMessage(caught, 'Не удалось сохранить график.'));
    } finally { setPending(false); }
  };
  return <Surface padding="md">
    {loading ? <LoadingState label="Проверка доступа к графикам" /> : null}
    {error ? <Alert tone="danger">{error}<Button disabled={pending} onClick={() => { void refresh(); }}>Обновить данные</Button></Alert> : null}
    <AccessSnapshotBoundary blocked={accessBlocked}>
    {dialog}
    <div className={styles.content}>
      <div className="ui-section-header"><h3 className="ui-section-title">Штатные позиции и графики</h3>
        {canManagePositions && !draft ? <Button onClick={() => start(null)}>Добавить позицию</Button> : null}
      </div>
      <p className="ui-text-muted">Фонд команды распределяется по позициям, а не по числу сотрудников. <a href="#planning">Фонд, датированные условия и история начислений — в «Бюджете и сезонах»</a>. Подмена получает оплату вместо основного по условиям заменяемой смены.</p>
      {loading ? <LoadingState label="Загрузка графиков" /> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      {conflict ? <Alert tone="warning">Сервер отклонил запись. Черновик сохранён; автоматического повтора нет. Сравните его со свежими данными и проверьте дату новой версии.
        {editing ? <div><Button onClick={async () => {
          try {
            const response = await getStaffingPositions(objectId);
            setData(response);
            const fresh = response.positions.find((position) => position.id === editing.id);
            if (fresh && await confirm({ title: 'Загрузить сохранённую версию?', consequence: 'Введённый черновик будет заменён. При необходимости сначала скопируйте его значения для сравнения.', confirmLabel: 'Загрузить версию' })) start(fresh);
          } catch (caught) { setError(getErrorMessage(caught, 'Не удалось загрузить свежую версию.')); }
        }}>Загрузить версию в редактор</Button></div> : null}
      </Alert> : null}
      {data?.positions.map((position) => {
        const latest = position.revisions.at(-1);
        if (!latest) return null;
        return <section key={position.id} className={styles.section}>
          <div className="ui-section-header"><strong>{latest.name}</strong>{canManagePositions && !draft ? <Button onClick={() => start(position)}>Изменить график</Button> : null}</div>
          <p>Последняя версия с {latest.effectiveFrom}{latest.archived ? ' · Архивная' : ''}. Общий штат: {latest.headcount ?? 'не задан'}. Нужно одновременно: {latest.requiredPerShift}.</p>
          <details><summary>Группы и история версий ({position.revisions.length})</summary>
            {position.revisions.map((revision) => <div className={styles.section} key={revision.id}>
              <strong>С {revision.effectiveFrom} · {revision.name}</strong>
              {revision.groups.map((group) => <div key={group.key}>{group.name}: сдвиг {group.offsetDays}; {group.timeRanges.map((range) => `${range.start}–${range.end}${range.endDayOffset ? ' следующего дня' : ''}`).join(', ')}.
                <div className="ui-text-muted">{group.assignments.length ? group.assignments.map((assignment) => `${names.get(assignment.employeeId) ?? 'Сотрудник из сохранённого назначения'} с ${assignment.from}${assignment.to ? ` по ${assignment.to}` : ''}`).join('; ') : 'Нет назначений'}</div>
              </div>)}
            </div>)}
          </details>
        </section>;
      })}
      {!loading && data && data.positions.length === 0 && !draft ? <EmptyState title="Позиции пока не заведены" description="Действующий состав и прежняя посещаемость доступны ниже." /> : null}
      {draft && !canManagePositions ? <Alert tone="warning">Право изменения графика отозвано. Черновик сохранён; автоматического повтора нет.</Alert> : null}
      {draft && data ? <form onSubmit={(event) => { void save(event); }} className={styles.editor}>
        {draftAccessMessage ? <Alert tone="warning">{draftAccessMessage}</Alert> : null}
        {editing ? <p className="ui-text-muted">Новая дата действия — сегодня или позднее. При совпадении даты применяется последняя версия; будущие версии сохраняются. Прошлые начисления не меняются.</p> : null}
        <PositionEditor value={draft} onChange={setDraft} disabled={pending || !canManagePositions} canAssignEmployees={canSelectEmployees && data.capabilities.manageAssignments}
          contours={contours.filter((contour) => contour.isActive).map((contour) => ({ value: contour.id, label: contour.name }))} canSelectPayConditions={data.capabilities.selectPayConditions}
          searchEmployees={async (search) => (await searchEmployeeDirectory(objectId, search)).map((employee) => ({ value: employee.id, label: employee.fullName, description: employee.position ?? undefined }))} />
        <SchedulePreviewPanel draftKey={JSON.stringify(draft)} employeeNames={names} onPreview={(from, to) => previewSchedule(objectId, { from, to, draft: positionPayload(draft) })} />
        <div className="ui-inline"><Button type="submit" variant="primary" pending={pending} disabled={conflict || !canManagePositions || !!draftAccessMessage}>Сохранить график</Button>
          <Button disabled={pending} onClick={async () => { if (await confirm({ title: 'Закрыть редактор?', consequence: 'Несохранённый черновик графика будет потерян.', confirmLabel: 'Закрыть' })) setDraft(null); }}>Отмена</Button></div>
      </form> : data ? <SchedulePreviewPanel draftKey={JSON.stringify(data.positions)} employeeNames={names} onPreview={(from, to) => previewSchedule(objectId, { from, to })} /> : null}
      {contourError ? <Alert tone="warning">{contourError}</Alert> : null}
      {data ? <PayContoursPanel objectId={objectId} items={contours} onChange={setContours} canManageRates={data.capabilities.manageRates} /> : null}
    </div>
    </AccessSnapshotBoundary>
  </Surface>;
}
