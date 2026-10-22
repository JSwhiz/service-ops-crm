import React from 'react';

import { getOneTimeOrderConflictTypeLabel } from '@/shared/lib/one-time-order-presentation';

export interface ScheduleConflict {
  date: string;
  type: string;
  user: { fullName: string };
}

const VISIBLE_CONFLICTS = 8;

/** Body for the «save with schedule conflicts?» confirmation. */
export function ScheduleConflictList({ conflicts }: { conflicts: ScheduleConflict[] }): React.JSX.Element {
  const relevant = conflicts.filter((conflict) => conflict.type !== 'pending_availability_request');
  const visible = relevant.slice(0, VISIBLE_CONFLICTS);
  return (
    <div className="ui-stack ui-stack--sm">
      <p>У сотрудников уже есть занятость на эти даты:</p>
      <ul className="ui-plain-list">
        {visible.map((conflict, index) => (
          <li key={`${conflict.date}-${conflict.user.fullName}-${index}`}>
            {conflict.date} · {conflict.user.fullName} · {getOneTimeOrderConflictTypeLabel(conflict.type)}
          </li>
        ))}
      </ul>
      {relevant.length > visible.length ? <p>И ещё {relevant.length - visible.length}.</p> : null}
    </div>
  );
}
