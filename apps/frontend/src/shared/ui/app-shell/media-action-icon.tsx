import React from 'react';

export function MediaActionIcon({
  name,
}: {
  name: 'camera' | 'gallery' | 'file' | 'download' | 'edit' | 'trash' | 'check' | 'close' | 'replace' | 'freeze' | 'archive';
}): React.JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  if (name === 'camera') {
    return <svg {...common}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></svg>;
  }

  if (name === 'gallery') {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>;
  }

  if (name === 'download') {
    return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 16v4h14v-4"/></svg>;
  }

  if (name === 'edit') {
    return <svg {...common}><path d="m14 5 5 5M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z"/><path d="M13.8 6.8 17.2 10.2"/></svg>;
  }

  if (name === 'trash') {
    return <svg {...common}><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>;
  }

  if (name === 'check') {
    return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  }

  if (name === 'close') {
    return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  }

  if (name === 'replace') {
    return <svg {...common}><path d="M4 7h13l-3-3m6 13H7l3 3"/><path d="M17 4 20 7l-3 3M7 14l-3 3 3 3"/></svg>;
  }

  if (name === 'freeze') {
    return <svg {...common}><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M8 5l4 2.3L16 5M8 19l4-2.3 4 2.3M4.5 11l.2-4.6 4.1 1.2M19.5 13l-.2 4.6-4.1-1.2M15.2 7.6l4.1-1.2.2 4.6M8.8 16.4l-4.1 1.2-.2-4.6"/></svg>;
  }

  if (name === 'archive') {
    return <svg {...common}><path d="M4 7h16v14H4zM3 3h18v4H3zM9 12h6"/></svg>;
  }

  return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>;
}
