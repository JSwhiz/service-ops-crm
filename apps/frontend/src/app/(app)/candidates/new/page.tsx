'use client';

import React from 'react';
import CandidatesPage from '@/app/(app)/candidates/page';
import { CandidateCreateDialog } from '@/features/candidate-create/ui/candidate-create-dialog';

export default function NewPage(): React.JSX.Element {
  return <><CandidatesPage /><CandidateCreateDialog /></>;
}
