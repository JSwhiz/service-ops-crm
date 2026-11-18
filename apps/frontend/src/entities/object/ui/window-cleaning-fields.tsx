'use client';

import React from 'react';
import { Button, IconButton } from '@/shared/ui/foundation';
import { PlusIcon, TrashIcon } from '@/shared/ui/icons/icons';
import { SelectField } from '@/shared/ui/searchable-select/select-field';
import { WINDOW_SEASON_OPTIONS, type WindowCleaningDraft } from '../lib/window-cleaning';
import type { WindowCleaningMode, WindowCleaningSeason } from '../model/object.types';
import styles from './window-cleaning-fields.module.css';

export function WindowCleaningFields({ value, onChange, disabled = false, legacySummer = false }: {
  value: WindowCleaningDraft;
  onChange: (value: WindowCleaningDraft) => void;
  disabled?: boolean;
  legacySummer?: boolean;
}): React.JSX.Element {
  const scheduled = value.windowCleaningMode === 'scheduled';
  const complete = value.windowCleaningSeasons.length > 0 && value.windowCleaningSeasons.every(Boolean);
  return <section className={styles.root} aria-label="Мытьё окон">
    <h3>Мытьё окон</h3>
    {value.windowCleaningMode === null && legacySummer ? <p className="ui-text-muted">Ранее указано летнее мытьё окон, периодичность не указана. Старый признак сохранён отдельно; новый график задаётся строками ниже.</p> : null}
    <SelectField label="Режим мытья окон" value={value.windowCleaningMode ?? ''} disabled={disabled} searchable={false} clearable={false}
      options={[...(value.windowCleaningMode === null ? [{ value: '', label: 'Не уточнено' }] : []), { value: 'scheduled', label: 'По графику' }, { value: 'on_request', label: 'По заявке' }, { value: 'notprovided', label: 'Не предусмотрено' }]}
      onChange={mode => { if (mode) onChange({ ...value, windowCleaningMode: mode as WindowCleaningMode }); }} />
    {scheduled ? <>
      <p className="ui-text-muted">Одна строка — один плановый выезд. Один сезон можно выбрать несколько раз.</p>
      {value.windowCleaningSeasons.map((season, index) => <div key={index} className={styles.row}>
        <SelectField label={`Время года, выезд ${index + 1}`} value={season} disabled={disabled} searchable={false} clearable={false} required
          options={WINDOW_SEASON_OPTIONS.map(option => ({ ...option }))}
          onChange={next => onChange({ ...value, windowCleaningSeasons: value.windowCleaningSeasons.map((current, row) => row === index ? next as WindowCleaningSeason : current) })} />
        <IconButton aria-label={`Удалить плановый выезд ${index + 1}`} disabled={disabled} onClick={() => onChange({ ...value, windowCleaningSeasons: value.windowCleaningSeasons.filter((_, row) => row !== index) })}><TrashIcon /></IconButton>
      </div>)}
      <Button type="button" icon={<PlusIcon />} disabled={disabled} onClick={() => onChange({ ...value, windowCleaningSeasons: [...value.windowCleaningSeasons, ''] })}>Добавить выезд</Button>
      <p className="ui-text-muted" role="status">{complete ? `Плановых выездов в год: ${value.windowCleaningSeasons.length}` : 'Заполните время года для каждого выезда. Количество определяется строками графика.'}</p>
    </> : null}
  </section>;
}
