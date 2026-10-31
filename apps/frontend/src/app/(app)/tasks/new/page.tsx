'use client';

import React from 'react';
import TasksPage from '@/app/(app)/tasks/page';
import { TaskCreateDialog } from '@/features/task-create/ui/task-create-dialog';

export default function NewPage(): React.JSX.Element {
  return <><TasksPage /><TaskCreateDialog /></>;
}
