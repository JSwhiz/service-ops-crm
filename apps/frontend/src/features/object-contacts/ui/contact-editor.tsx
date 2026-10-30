'use client';

import React from 'react';
import { Field } from '@/shared/ui/foundation';
import { PhoneListField, phoneDrafts, phoneDraftValues, type PhoneDraft } from '@/shared/ui/phone-list-field/phone-list-field';
import type { ContactInput } from '@/entities/object/api/object-planning-client';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';

export interface ContactDraft {
  key: string; name: string; position: string; phones: PhoneDraft[]; emails: string; links: string; notes: string;
}
export function newContactDraft(): ContactDraft {
  return { key: crypto.randomUUID(), name: '', position: '', phones: phoneDrafts([]), emails: '', links: '', notes: '' };
}
export function contactPayload(value: ContactDraft): ContactInput {
  const lines = (text: string): string[] => [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))];
  if (!value.name.trim()) throw new Error('Укажите имя или название контакта.');
  return { name: value.name.trim(), position: value.position.trim() || undefined, phones: phoneDraftValues(value.phones), emails: lines(value.emails), links: lines(value.links), notes: value.notes.trim() || undefined };
}
export function ContactEditor({ value, onChange, disabled }: { value: ContactDraft; onChange: (value: ContactDraft) => void; disabled?: boolean }): React.JSX.Element {
  const patch = (next: Partial<ContactDraft>): void => onChange({ ...value, ...next });
  return <div className={styles.formGrid}>
    <Field label="Имя или название контакта" required><input value={value.name} maxLength={160} disabled={disabled} onChange={(event) => patch({ name: event.target.value })} /></Field>
    <Field label="Должность / роль"><input value={value.position} maxLength={160} disabled={disabled} onChange={(event) => patch({ position: event.target.value })} /></Field>
    <div className={styles.fullWidth}><PhoneListField phones={value.phones} disabled={disabled} onChange={(phones) => patch({ phones })} /></div>
    <Field label="Электронная почта" description="Каждый адрес с новой строки"><textarea value={value.emails} disabled={disabled} onChange={(event) => patch({ emails: event.target.value })} /></Field>
    <Field label="Ссылки на соцсети и сайты" description="Каждая ссылка с https:// с новой строки"><textarea value={value.links} disabled={disabled} onChange={(event) => patch({ links: event.target.value })} /></Field>
    <Field label="Примечание"><textarea value={value.notes} maxLength={4000} disabled={disabled} onChange={(event) => patch({ notes: event.target.value })} /></Field>
  </div>;
}
