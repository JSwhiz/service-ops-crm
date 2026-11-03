'use client';

import React, { useState } from 'react';
import type { PayContour } from '@/entities/object/model/object-scheduling.types';
import { createPayContour, getPayContours } from '@/entities/object/api/object-scheduling-client';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button } from '@/shared/ui/foundation';
import { useConfirm } from '@/shared/ui/overlays';
import { getErrorMessage } from '@/shared/lib/error-message';
import { contourPayload, newContourDraft, type ContourDraft } from '../model/contour-draft';
import { PayContourEditor } from './pay-contour-editor';
import styles from './object-scheduling.module.css';
import { getObjectCompensation } from '@/entities/object/api/object-compensation-client';
import type { CompensationVersion } from '@/entities/object/model/object-compensation.types';
import { CompensationVersionDialog } from '@/features/object-compensation/ui/compensation-version-dialog';

export function PayContoursPanel({ objectId, items, onChange, canManageRates }: { objectId: string; items: PayContour[]; onChange: (items: PayContour[]) => void; canManageRates: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState<ContourDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirm, dialog] = useConfirm();
  const [versionTarget, setVersionTarget] = useState<PayContour | null>(null);
  const [versions, setVersions] = useState<CompensationVersion[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const beginVersion = async (contour: PayContour): Promise<void> => {
    if (pending) return;
    setPending(true); setError(null); setSuccess(null);
    try { setVersions((await getObjectCompensation(objectId)).versions); setVersionTarget(contour); }
    catch (caught) { setError(getErrorMessage(caught, 'Не удалось загрузить версии условий.')); }
    finally { setPending(false); }
  };
  const begin = (): void => {
    setError(null); setConflict(false); setSuccess(null); setDraft(newContourDraft());
  };
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || !draft || conflict) return;
    setPending(true); setError(null);
    try {
      const { code, ...fields } = contourPayload(draft);
      const saved = await createPayContour(objectId, { ...fields, code });
      onChange([...items.filter((item) => item.id !== saved.id), saved]); setDraft(null);
    } catch (caught) { setError(getErrorMessage(caught, 'Не удалось сохранить условия оплаты.')); setConflict(caught instanceof ApiError && caught.statusCode === 409); }
    finally { setPending(false); }
  };
  return <section className={styles.section} aria-label="Контуры оплаты">
    {dialog}
    <div className="ui-section-header"><h3 className="ui-section-title">Контуры оплаты</h3>{canManageRates && !draft ? <Button disabled={pending} onClick={begin}>Добавить условия оплаты</Button> : null}</div>
    <p className="ui-text-muted">Один контур — один оплачиваемый выход сотрудника в день. Отдельные дневной и ночной контуры суммируются. Месячная сумма не умножается на смены. Начисление не является выплатой.</p>
    {items.length ? items.map((contour) => <div key={contour.id} className={styles.section}>
      <div className="ui-section-header"><strong>{contour.name}{contour.isActive ? '' : ' · Неактивен'}</strong>{canManageRates && !draft ? <Button disabled={pending} onClick={() => { void beginVersion(contour); }}>Новая версия условий</Button> : null}</div>
      <p>Справочная ставка каталога: за выход {contour.dailyRate.toLocaleString('ru-RU')} ₽; лето: {contour.summerDailyRate === null ? 'базовая ставка' : `${contour.summerDailyRate.toLocaleString('ru-RU')} ₽`}; зима: {contour.winterDailyRate === null ? 'базовая ставка' : `${contour.winterDailyRate.toLocaleString('ru-RU')} ₽`}. Действующие датированные условия и фонд — в «Бюджете и сезонах».</p>
    </div>) : <p className="ui-text-muted">Отдельные контуры не заведены. Используются действующие условия сотрудника и объекта.</p>}
    {error ? <Alert tone="danger">{error}</Alert> : null}
    {success ? <Alert tone="success" role="status">{success} <a href="#planning">Открыть сохранённые версии</a></Alert> : null}
    {versionTarget ? <CompensationVersionDialog objectId={objectId} line={{ key: versionTarget.id, name: versionTarget.name, scope: 'contour', scopeId: versionTarget.id }} versions={versions} initialTerms={{ ratePolicyType: 'daily_rate', baseAmount: versionTarget.dailyRate, summerAmount: versionTarget.summerDailyRate, winterAmount: versionTarget.winterDailyRate }} onClose={() => setVersionTarget(null)} onSaved={() => { setVersionTarget(null); setSuccess('Новая версия оплаты сохранена; прошлые начисления не пересчитаны.'); }} /> : null}
    {conflict ? <Alert tone="warning">Запись отклонена. Черновик сохранён; автоматического повтора нет. Обновление списка не заменяет черновик.
      <div><Button onClick={async () => { try { onChange((await getPayContours(objectId)).contours); } catch (caught) { setError(getErrorMessage(caught, 'Не удалось обновить условия.')); } }}>Обновить список для сравнения</Button></div>
    </Alert> : null}
    {draft ? <form className={styles.editor} onSubmit={(event) => { void save(event); }}>
      <PayContourEditor value={draft} onChange={setDraft} disabled={pending} />
      <p className="ui-text-muted">Изменения действуют с текущей даты. Подтверждённые снимки ставок сохраняются.</p>
      <div className="ui-inline"><Button type="submit" variant="primary" pending={pending} disabled={conflict}>Сохранить условия</Button>
        <Button disabled={pending} onClick={async () => { if (await confirm({ title: 'Закрыть редактор условий?', consequence: 'Несохранённые значения будут потеряны.', confirmLabel: 'Закрыть' })) setDraft(null); }}>Отмена</Button></div>
    </form> : null}
  </section>;
}
