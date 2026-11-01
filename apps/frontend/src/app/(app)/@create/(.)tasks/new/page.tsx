'use client';

import React from 'react';
import { TaskCreateDialog } from '@/features/task-create/ui/task-create-dialog';

export default function InterceptedCreatePage(): React.JSX.Element {
  return <TaskCreateDialog />;
}
