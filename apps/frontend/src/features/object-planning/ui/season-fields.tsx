'use client';

import React from 'react';
import { Field } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';

/** No default months: annual boundaries must come from saved configuration or explicit input. */
export function SeasonFields({ automatic, summer, winter, onAutomaticChange, onSummerChange, onWinterChange, disabled }: {
  automatic: boolean; summer: string; winter: string; onAutomaticChange: (value: boolean) => void;
  onSummerChange: (value: string) => void; onWinterChange: (value: string) => void; disabled?: boolean;
}): React.JSX.Element {
  return <>
    <label className="ui-inline"><input type="checkbox" checked={automatic} disabled={disabled} onChange={(event) => onAutomaticChange(event.target.checked)} /> Сезонность включена</label>
    <p className="ui-text-muted">{automatic ? 'Летние и зимние условия переключаются автоматически по заданным ежегодным границам, по Москве. Год в календаре не учитывается; 29 февраля не используется.' : 'Используются базовые условия оплаты. Даты сезонов и сохранённые сезонные настройки можно задать при включении.'}</p>
    {automatic ? <>
      <Field label="Ежегодное начало лета" required><DatePicker value={summer} onChange={onSummerChange} disabled={disabled} /></Field>
      <Field label="Ежегодное начало зимы" required><DatePicker value={winter} onChange={onWinterChange} disabled={disabled} /></Field>
    </> : null}
  </>;
}
