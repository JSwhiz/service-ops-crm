'use client';

import React from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from './searchable-select';

/** Minimal change event so handlers written for native selects keep working. */
export interface SelectChangeEvent {
  target: { value: string };
  currentTarget: { value: string };
}

export interface SelectProps {
  name?: string;
  value: string;
  onChange?: (event: SelectChangeEvent) => void;
  /** `<option>` elements, as with a native select (arrays and fragments allowed). */
  children: React.ReactNode;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

function optionText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return optionText(node.props.children);
  return '';
}

type SelectOption = SearchableSelectOption & { disabled: boolean };

function collectOptions(children: React.ReactNode, into: SelectOption[] = []): SelectOption[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string | number; disabled?: boolean }>(child)) return;
    if (child.type === React.Fragment) {
      collectOptions(child.props.children, into);
      return;
    }
    if (child.type === 'option') {
      const label = optionText(child.props.children).trim();
      into.push({ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) });
    }
  });
  return into;
}

/**
 * Drop-in replacement for a native `<select>` that renders the system dropdown
 * (same trigger, popover and keyboard behaviour as SearchableSelect) in every
 * browser. Works inside Field: the label is linked through `id`.
 */
export function Select({
  name,
  value,
  onChange,
  children,
  id,
  disabled,
  required,
  placeholder,
  className,
  onFocus,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: SelectProps): React.JSX.Element {
  const options = collectOptions(children);
  const enabledOptions = options.filter((option) => !option.disabled);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  return (
    <div className={className}>
      <SearchableSelect
        label={ariaLabel ?? ''}
        hideLabel
        value={value}
        options={enabledOptions}
        selectedOption={selectedOption}
        placeholder={placeholder ?? options.find((option) => option.value === '')?.label ?? 'Выберите значение'}
        clearable={false}
        searchable={options.length > 10}
        searchPlaceholder="Поиск"
        disabled={disabled}
        required={Boolean(required || ariaRequired === true || ariaRequired === 'true')}
        triggerProps={{
          name,
          id,
          onFocus,
          'aria-describedby': ariaDescribedBy,
          'aria-invalid': ariaInvalid,
        }}
        onChange={(nextValue) => {
          if (!enabledOptions.some((option) => option.value === nextValue)) return;
          const event = { target: { value: nextValue }, currentTarget: { value: nextValue } };
          onChange?.(event);
        }}
      />
    </div>
  );
}
