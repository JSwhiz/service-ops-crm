'use client';

import React from 'react';

import { Button, IconButton } from '@/shared/ui/foundation';

import styles from './phone-list-field.module.css';
import { CloseIcon, PlusIcon } from '@/shared/ui/icons/icons';

export interface PhoneDraft {
  key: string;
  value: string;
}

export const MAX_PHONES = 10;

export function phoneDrafts(phones: string[], keepEmptyRow = true): PhoneDraft[] {
  const values = phones.length || !keepEmptyRow ? phones : [''];
  return values.map((value, index) => ({ key: `phone-${index}`, value }));
}

export function phoneDraftValues(phones: PhoneDraft[]): string[] {
  return phones.map((phone) => phone.value.trim()).filter(Boolean);
}

/** Valid when every filled number has at least 3 digits (and at least one when required). */
export function phoneDraftsValid(phones: PhoneDraft[], required = false): boolean {
  const values = phoneDraftValues(phones);
  if (required && (!values.length || values.length !== phones.length)) return false;
  return values.every((value) => value.replace(/\D/g, '').length >= 3);
}

interface PhoneListFieldProps {
  phones: PhoneDraft[];
  onChange: (phones: PhoneDraft[]) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * One labelled group of phone inputs: the first number is the main one, others
 * are added and removed inline. Shared by employee and candidate forms.
 */
export function PhoneListField({
  phones,
  onChange,
  label = 'Телефоны',
  required = false,
  disabled = false,
}: PhoneListFieldProps): React.JSX.Element {
  const rows = phones.length ? phones : phoneDrafts([]);
  const update = (key: string, value: string): void =>
    onChange(rows.map((phone) => (phone.key === key ? { ...phone, value } : phone)));
  const invalid = rows.some(
    (phone) => phone.value.trim() && phone.value.replace(/\D/g, '').length < 3,
  );

  return (
    <fieldset className={styles.root} disabled={disabled}>
      <legend className="ui-field__label">
        {label}
        {required ? <span className="ui-field__required"> *</span> : null}
      </legend>
      <div className={styles.rows}>
        {rows.map((phone, index) => (
          <div key={phone.key} className={styles.row}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete={index === 0 ? 'tel' : 'off'}
              maxLength={50}
              required={required}
              placeholder="+7 900 000-00-00"
              aria-label={index === 0 ? 'Основной телефон' : `Телефон ${index + 1}`}
              aria-invalid={Boolean(phone.value.trim()) && phone.value.replace(/\D/g, '').length < 3}
              value={phone.value}
              onChange={(event) => update(phone.key, event.target.value)}
            />
            {index === 0 && rows.length > 1 ? (
              <span className={styles.mainTag}>Основной</span>
            ) : null}
            {rows.length > 1 ? (
              <IconButton
                aria-label={`Удалить телефон ${phone.value || index + 1}`}
                title="Удалить телефон"
                className={styles.remove}
                onClick={() => onChange(rows.filter((item) => item.key !== phone.key))}
              >
                <CloseIcon size={16} />
              </IconButton>
            ) : null}
          </div>
        ))}
      </div>
      {invalid ? (
        <div className="ui-field__error" role="alert">
          В номере должно быть не меньше 3 цифр.
        </div>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className={styles.add}
        icon={<PlusIcon />}
        disabled={disabled || rows.length >= MAX_PHONES}
        onClick={() =>
          onChange([...rows, { key: crypto.randomUUID(), value: '' }])
        }
      >
        Добавить телефон
      </Button>
    </fieldset>
  );
}
