'use client';

import React from 'react';
import EmployeesRegistryPage from '@/app/(app)/employees/page';
import { EmployeeCreateDialog } from '@/features/employee-create/ui/employee-create-dialog';

export default function NewEmployeePage(): React.JSX.Element {
  return <><EmployeesRegistryPage /><EmployeeCreateDialog /></>;
}
