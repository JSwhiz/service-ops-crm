'use client';

import React from 'react';
import { Button, EmptyState } from '@/shared/ui/foundation';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { newPositionDraft, type PositionDraft } from '../model/schedule-draft';
import { PositionEditor } from './position-editor';
import type { SchedulePreview } from '@/entities/object/model/object-scheduling.types';
import { SchedulePreviewPanel } from './schedule-preview';
import styles from './object-scheduling.module.css';

interface PositionsEditorProps {
  value: PositionDraft[];
  onChange: (value: PositionDraft[]) => void;
  disabled?: boolean;
  canAssignEmployees: boolean;
  employeeAccessMessage?: string;
  searchEmployees: (query: string) => Promise<SearchableSelectOption[]>;
  contours?: { value: string; label: string }[];
  canSelectPayConditions?: boolean;
  onPreview?: (position: PositionDraft, from: string, to: string) => Promise<SchedulePreview>;
}

/** Controlled composition shared by atomic creation and the existing object workspace. */
export function PositionsEditor({ value, onChange, disabled, canAssignEmployees, employeeAccessMessage, searchEmployees, contours, canSelectPayConditions, onPreview }: PositionsEditorProps): React.JSX.Element {
  return <div className={styles.editor}>
    <div>
      <h2 className="ui-section-title">Штатные позиции и графики</h2>
      <p className="ui-section-subtitle">Дополнительный раздел. Позиции можно добавить сейчас или позднее в «Команде» объекта.</p>
    </div>
    {value.length === 0 ? <EmptyState title="Позиции пока не добавлены" description="Создание объекта без позиций и сотрудников доступно." /> : null}
    {value.map((position, index) => <section key={position.key} className={styles.section} aria-label={`Позиция ${index + 1}`}>
      <h3 className="ui-section-title">{position.name || `Позиция ${index + 1}`}</h3>
      <PositionEditor value={position} disabled={disabled} canAssignEmployees={canAssignEmployees} employeeAccessMessage={employeeAccessMessage} searchEmployees={searchEmployees} contours={contours} canSelectPayConditions={canSelectPayConditions} onChange={(next) => onChange(value.map((item) => item.key === position.key ? next : item))} />
      {onPreview ? <SchedulePreviewPanel draftKey={JSON.stringify(position)} employeeNames={new Map(position.groups.flatMap((group) => group.assignments.map((assignment) => [assignment.employeeId, assignment.employeeName])))} onPreview={(from, to) => onPreview(position, from, to)} /> : null}
      <div><Button disabled={disabled} onClick={() => onChange(value.filter((item) => item.key !== position.key))}>Убрать позицию из черновика</Button></div>
    </section>)}
    <div><Button disabled={disabled} onClick={() => onChange([...value, newPositionDraft()])}>Добавить позицию</Button></div>
  </div>;
}
