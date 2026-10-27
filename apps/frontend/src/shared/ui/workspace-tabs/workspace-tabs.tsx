'use client';

import React from 'react';
import styles from './workspace-tabs.module.css';

export interface WorkspaceTabItem {
  value: string;
  label: string;
}

export function WorkspaceTabs({
  items,
  value,
  onChange,
  label,
  idPrefix = 'workspace',
}: {
  items: WorkspaceTabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  idPrefix?: string;
}): React.JSX.Element {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number): void => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.root} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(node) => { refs.current[index] = node; }}
          id={`${idPrefix}-tab-${item.value}`}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          aria-controls={`${idPrefix}-panel-${item.value}`}
          tabIndex={value === item.value ? 0 : -1}
          className={value === item.value ? styles.active : undefined}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); focusTab(index + 1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); focusTab(index - 1); }
            if (event.key === 'Home') { event.preventDefault(); focusTab(0); }
            if (event.key === 'End') { event.preventDefault(); focusTab(items.length - 1); }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
