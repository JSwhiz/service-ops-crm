'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Drawer } from '@/shared/ui/overlays';
import { compactPersonName } from '@/shared/ui/person-presentation/compact-person-name';
import styles from './timesheet-ui.module.css';

/** Disclosure lives outside the grid so a long name never changes column or row geometry. */
export function TimesheetIdentity({ name, person = false }: { name: string; person?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [open]);
  return <>
    <button ref={triggerRef} type="button" className={styles.timesheetIdentity} aria-label={`${person ? 'Сотрудник' : 'Объект'}: ${name}`} aria-haspopup="dialog" aria-expanded={open} title={name} onClick={() => setOpen(true)}>{person ? compactPersonName(name) : name}</button>
    {open ? <Drawer open={open} onOpenChange={setOpen} title={person ? 'Сотрудник' : 'Объект'} returnFocusRef={triggerRef}><p className={styles.timesheetFullIdentity}>{name}</p></Drawer> : null}
  </>;
}
