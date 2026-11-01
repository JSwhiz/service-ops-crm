'use client';

import React from 'react';
import { useParams } from 'next/navigation';

import { FileViewer } from '@/shared/ui/media-entry/file-viewer';

export default function FileViewerPage(): React.JSX.Element {
  const params = useParams<{ fileId: string }>();
  return <FileViewer fileId={params.fileId} />;
}
