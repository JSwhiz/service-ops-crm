'use client';

import React, { useEffect, useState } from 'react';
import { getCompensationExplanation } from '@/entities/object/api/object-compensation-client';
import type { CompensationExplanation } from '@/entities/object/model/object-compensation.types';
import { getErrorMessage } from '@/shared/lib/error-message';
import { formatUiDate } from '@/shared/lib/format-date';
import { Alert, Button, FactStrip, LoadingState, Surface } from '@/shared/ui/foundation';
import styles from './team-compensation.module.css';

const money = (value: number): string => `${value.toLocaleString('ru-RU')} ₽`;

export function CompensationExplanationPanel({ objectId, year, month, employeeId, revision }: {
  objectId: string; year: number; month: number; employeeId?: string; revision?: number;
}): React.JSX.Element {
  const [data, setData] = useState<CompensationExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setData(null); setError(null);
    void getCompensationExplanation(objectId, year, month).then((result) => { if (active) setData(result); })
      .catch((caught) => { if (active) setError(getErrorMessage(caught, 'Расшифровка начислений недоступна.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId, year, month, revision, retry]);
  const rows = data?.rows.filter((r) => !employeeId || r.employeeId === employeeId) ?? [];
  return <Surface padding="md" as="section"><div className={styles.content}>
    <h3 className="ui-section-title">Из чего складываются аванс и зарплата</h3>
    <p className="ui-text-muted">При окладе каждая половина полной суммы × оплачиваемые дни / норма этой половины. Полный график даёт 50/50. Оплата за выход учитывает фактические выходы. Ручные правки показаны отдельно в табеле и истории корректировок; фактические выплаты здесь не учитываются.</p>
    {loading ? <LoadingState label="Загрузка расшифровки" /> : null}
    {error ? <Alert tone="warning" action={<Button onClick={() => setRetry((v) => v + 1)}>Повторить</Button>}>{error} Суммы табеля остаются источником сохранённой истории.</Alert> : null}
    {data?.unavailableReason ? <Alert tone="info">Расчёт недоступен: {data.unavailableReason}</Alert> : null}
    {data && !data.unavailableReason && !rows.length ? <p>Для выбранного сотрудника нет сохранённых начислений новой версии. История не пересчитывается при просмотре.</p> : null}
    {rows.map((row) => <section key={row.employeeId} className={styles.section}>
      <h4 className="ui-section-title">{row.employeeName}</h4>
      <FactStrip items={[{ label: 'Аванс · сохранённые начисления', value: money(row.advanceTotal) }, { label: 'Зарплата · сохранённые начисления', value: money(row.salaryTotal) }]} />
      {row.explanations.map((half, index) => <div key={`${half.compensationVersionId}:${half.poolKey}:${half.half}:${index}`} className={styles.section}>
        <strong>{half.half === 1 ? 'Аванс · 1–15' : 'Зарплата · 16–конец месяца'}</strong>
        <dl className={styles.facts}>
          <div><dt>Базовая половина</dt><dd>{money(half.baseHalf)}</dd></div>
          <div><dt>{half.poolKey ? 'Норма половины, выходов' : 'Норма половины, дней'}</dt><dd>{half.normDays === null ? 'Не определена' : half.normDays}</dd></div>
          <div><dt>{half.poolKey ? 'Оплачиваемые выходы' : 'Оплачиваемые дни'}</dt><dd>{half.paidDays}</dd></div>
          <div><dt>Из них праздники</dt><dd>{half.holidayDays}</dd></div>
          <div><dt>Расчётная сумма</dt><dd>{half.amount === null ? 'Расчёт недоступен' : money(half.amount)}</dd></div>
          <div><dt>Сохранено по этим условиям</dt><dd>{money(half.savedAmount)}</dd></div>
        </dl>
        {half.unavailableReason ? <Alert tone="warning">Расчёт недоступен: {half.unavailableReason}</Alert> : null}
        {half.poolKey ? <p className="ui-text-muted">Базовая половина общая для позиции и её сменщиков. Это не отдельный оклад каждому; сохранённая сумма учитывает долю сотрудника и распределение округления.</p> : null}
      </div>)}
      <details><summary>Сохранённые начисления и корректировки</summary>{row.entries.map((entry) => <div key={entry.id} className={styles.section}><strong>{formatUiDate(entry.operationDate)} · {money(entry.amount)}</strong><p>{entry.explanation}</p></div>)}</details>
      <p className="ui-text-muted">Праздник может оплачиваться без присутствия. Явные исключения и допработы отражаются в сохранённых начислениях; заявка на исправление прошлого периода действует только после независимого согласования.</p>
    </section>)}
  </div></Surface>;
}
