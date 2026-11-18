import React, { Suspense } from 'react';
import { WorkforceSubstitutionList } from '@/features/workforce-substitution-list/ui/workforce-substitution-list';
import { LoadingState } from '@/shared/ui/foundation';

export default function WorkforceSubstitutionsPage(): React.JSX.Element {
  return <Suspense fallback={<LoadingState label="Загрузка кадровых подмен…" />}><WorkforceSubstitutionList /></Suspense>;
}
