import Link from 'next/link';
import React from 'react';

import { CandidateRegistry } from '@/features/candidate-registry/ui/candidate-registry';
import styles from '@/features/employee-workspace/ui/employee-workspace.module.css';
import { PageHeader } from '@/shared/ui/foundation';

export default function EmployeesReservePage(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <PageHeader title="Сотрудники" />
      <nav className={styles.registryNav} aria-label="Разделы реестра">
        <Link href="/employees">Все</Link>
        <Link href="/employees?employeeType=regular">Постоянные</Link>
        <Link href="/employees?employeeType=one_time">Разовые</Link>
        <Link href="/employees?employeeType=substitution">Подменные</Link>
        <Link href="/employees?archiveState=archived">Архив</Link>
        <Link href="/employees/reserve" aria-current="page">Резерв</Link>
      </nav>
      <CandidateRegistry fixedType="reserve" />
    </div>
  );
}
