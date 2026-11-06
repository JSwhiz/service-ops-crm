'use client';

import React from 'react';

import { Field } from '@/shared/ui/foundation';
import { Select } from '@/shared/ui/searchable-select/select';

import styles from './access-rule-editor.module.css';

/** Local form choices; these are not server DTOs. */
export type AccessOverrideChoice = 'default' | 'allow' | 'deny';
export type AccessScopeChoice = 'own' | 'assigned' | 'selected' | 'all';

export interface AccessRuleEditorProps {
  title: string;
  description?: string;
  effectiveResult: React.ReactNode;
  source: React.ReactNode;
  effectiveScope: React.ReactNode;
  constraints?: React.ReactNode;
  editable: boolean;
  unavailableReason?: string;
  mode: AccessOverrideChoice;
  hasPersonalRule: boolean;
  scope: AccessScopeChoice | '';
  supportedScopes: ReadonlyArray<{ value: AccessScopeChoice; label: string }>;
  onModeChange: (mode: AccessOverrideChoice) => void;
  onScopeChange: (scope: AccessScopeChoice) => void;
  selectedEntitiesControl?: React.ReactNode;
  pending?: boolean;
  error?: string;
}

/** Effective values and restrictions are supplied by the caller, never inferred. */
export function AccessRuleEditor({
  title, description, effectiveResult, source, effectiveScope, constraints,
  editable, unavailableReason, mode, hasPersonalRule, scope, supportedScopes, onModeChange,
  onScopeChange, selectedEntitiesControl, pending = false, error,
}: AccessRuleEditorProps): React.JSX.Element {
  const titleId = React.useId();

  return (
    <section className={styles.rule} aria-labelledby={titleId}>
      <div className={styles.identity}>
        <h3 id={titleId} className={styles.title}>{title}</h3>
        {description ? <p className="ui-text-muted">{description}</p> : null}
      </div>
      <dl className={styles.facts}>
        <div><dt>Результат серверной политики</dt><dd>{effectiveResult}</dd></div>
        <div><dt>Источник</dt><dd>{source}</dd></div>
        <div><dt>Область</dt><dd>{effectiveScope}</dd></div>
      </dl>
      {constraints ? <div className={styles.constraints}>{constraints}</div> : null}
      {editable ? (
        <div className={styles.controls}>
          <Field label={`Персональное правило: ${title}`}>
            <Select
              name="accessOverride"
              value={mode}
              disabled={pending}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'default' || next === 'allow' || next === 'deny') onModeChange(next);
              }}
            >
              <option value="default">По умолчанию</option>
              <option value="allow">Разрешить персонально</option>
              <option value="deny">Запретить персонально</option>
            </Select>
          </Field>
          {mode !== 'default' && supportedScopes.length > 0 ? (
            <Field label={`Область персонального правила: ${title}`} required error={error || (!supportedScopes.some((option) => option.value === scope) ? 'Выберите поддерживаемую область.' : undefined)}>
              <Select
                name="accessScope"
                value={scope}
                placeholder="Выберите область…"
                disabled={pending}
                onChange={(event) => {
                  const next = supportedScopes.find((option) => option.value === event.target.value);
                  if (next) onScopeChange(next.value);
                }}
              >
                {supportedScopes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
          ) : null}
          {mode !== 'default' && scope === 'selected' ? <div className={styles.selection}>{selectedEntitiesControl}</div> : null}
          {mode === 'default' ? <p className="ui-text-muted">{hasPersonalRule
            ? 'После сохранения персональное исключение будет снято. Результат определяет сервер с учётом остальных источников и ограничений.'
            : 'Действуют права роли, назначения и другие источники. Результат определяет сервер с учётом ограничений.'}</p> : null}
        </div>
      ) : <p className="ui-text-muted">{unavailableReason ?? 'Персональное управление этим действием недоступно.'}</p>}
    </section>
  );
}
