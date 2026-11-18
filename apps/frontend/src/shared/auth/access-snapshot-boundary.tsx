'use client';

import React, { createContext, useContext } from 'react';

export const AccessSnapshotBlockedContext = createContext(false);

/** Conceal stale reads without unmounting a form's unsaved local state. */
export function AccessSnapshotBoundary({ blocked, children }: { blocked: boolean; children: React.ReactNode }): React.JSX.Element {
  const ancestorBlocked = useContext(AccessSnapshotBlockedContext);
  const concealed = ancestorBlocked || blocked;
  return <AccessSnapshotBlockedContext.Provider value={concealed}>
    <div hidden={concealed} style={{ display: concealed ? 'none' : 'contents' }}>{children}</div>
  </AccessSnapshotBlockedContext.Provider>;
}
