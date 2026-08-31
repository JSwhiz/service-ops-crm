import React from 'react';
import { CandidateRegistry } from '@/features/candidate-registry/ui/candidate-registry';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function CandidatesPage(): React.JSX.Element { return <div className="workspace-page"><PageTitle title="Кандидаты" /><CandidateRegistry /></div>; }
