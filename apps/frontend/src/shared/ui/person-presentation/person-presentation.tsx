'use client';

import React, { useId, useState } from 'react';
import { getUserDisplayName } from '@/shared/lib/display-name';
import styles from './person-presentation.module.css';
import { compactPersonName } from './compact-person-name';

interface PersonValue { id?: string; userId?: string; fullName?: string | null; login?: string | null; description?: string | null }

/** Cards keep the full name; dense cells reveal it by focus, click or touch. */
export function PersonName({ person, compact = false }: { person: PersonValue; compact?: boolean }): React.JSX.Element {
  const fullName = getUserDisplayName(person);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!compact || compactPersonName(fullName) === fullName) return <span className={styles.full}>{fullName}</span>;
  return <span className={styles.person}>
    <button type="button" className={styles.name} aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-label={fullName}
      onFocus={() => setExpanded(true)} onClick={(event) => { event.stopPropagation(); setExpanded(true); }}
      onBlur={() => setExpanded(false)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } }}>
      {compactPersonName(fullName)}
    </button>
    {expanded ? <span id={id} className={styles.full}>{fullName}{person.login ? <small>@{person.login}</small> : null}</span> : null}
  </span>;
}

export function PeopleList({ people, label = 'Люди', compact = true }: { people: PersonValue[]; label?: string; compact?: boolean }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!people.length) return <span>—</span>;
  return <div className={styles.group} onKeyDown={(event) => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); setExpanded(false); } }}>
    <div className={styles.summary}><PersonName person={people[0]!} compact={compact} />{people.length > 1 ? <button type="button" className={styles.more} aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-label={`${label}: показать всех (${people.length})`} onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current); }}>+{people.length - 1}</button> : null}</div>
    {people[0]!.description ? <small>{people[0]!.description}</small> : null}
    {expanded ? <ul id={id} className={styles.list} aria-label={label}>{people.map((person, index) => <li key={person.id ?? person.userId ?? index}><PersonName person={person} />{person.login ? <small>@{person.login}</small> : null}{person.description ? <small>{person.description}</small> : null}</li>)}</ul> : null}
  </div>;
}

export function RelatedValues({ values, label }: { values: Array<{ id: string; label: string }>; label: string }): React.JSX.Element {
  if (!values.length) return <span>—</span>;
  if (values.length === 1) return <span className={styles.full}>{values[0]!.label}</span>;
  return <details className={styles.group} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }}><summary className={styles.relatedSummary}>{values[0]!.label} <span className={styles.more}>+{values.length - 1}</span></summary><ul className={styles.list} aria-label={label}>{values.map((value) => <li key={value.id}>{value.label}</li>)}</ul></details>;
}
