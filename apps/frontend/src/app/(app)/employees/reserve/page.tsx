import Link from 'next/link';
import React from 'react';
import { CandidateRegistry } from '@/features/candidate-registry/ui/candidate-registry';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function EmployeesReservePage(): React.JSX.Element { return <div className="workspace-page"><PageTitle title="Сотрудники" /><nav className="employee-tabs" aria-label="Разделы реестра"><Link href="/employees">Все сотрудники</Link><Link href="/employees?employeeType=regular">Постоянные</Link><Link href="/employees?employeeType=one_time">Разовые</Link><Link href="/employees?archiveState=archived">Архив</Link><Link href="/employees/reserve" className="is-active" aria-current="page">Резерв</Link></nav><CandidateRegistry fixedType="reserve" /></div>; }
