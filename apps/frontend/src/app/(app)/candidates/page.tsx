import React from 'react';
import { CandidateRegistry } from '@/features/candidate-registry/ui/candidate-registry';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function CandidatesPage(): React.JSX.Element { return <><PageTitle title="Кандидаты" /><CandidateRegistry /></>; }
