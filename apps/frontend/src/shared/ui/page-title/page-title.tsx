import React from 'react';

interface PageTitleProps {
  title: string;
}

export function PageTitle({ title }: PageTitleProps): React.JSX.Element {
  return <h1 className="page-title">{title}</h1>;
}
