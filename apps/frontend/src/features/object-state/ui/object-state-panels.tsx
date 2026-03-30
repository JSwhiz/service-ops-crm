import React from 'react';

export function ObjectPanelLoading({
  title,
}: {
  title: string;
}): React.JSX.Element {
  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{title}</div>
      <div className="page-muted">Загрузка...</div>
    </div>
  );
}

export function ObjectPanelError({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.JSX.Element {
  return (
    <div className="page-card">
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{title}</div>
      <div style={{ color: '#b91c1c' }}>{message}</div>
    </div>
  );
}
