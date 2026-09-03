# Leadership Dashboard v1 — operational rules

This note records the currently approved runtime rules used by the Wave 2 leadership dashboard. It does not replace canonical product docs.

- Role-specific dashboards remain the product direction. Leadership is the first implementation family.
- Attendance business window: 08:30–17:00 Europe/Moscow.
- During that window, an active object with no attendance facts for the current day is surfaced as an operational issue.
- Daily report becomes due at 17:00 Europe/Moscow. An active object with no authoritative ObjectDailyReport for the current calendar day is surfaced as an issue after that time.
- Active object without responsible user is an issue.
- Active object without assigned employees is an issue.
- Dashboard task preview shows at most five active tasks, prioritizing current-user work before company-wide overdue tasks.
- Company-wide overdue tasks remain visible, but below personally relevant work.
- Employees and CRM Users are separate domains. User absence schedule must not reuse Employee availability.
- User absence schedule is planned for vacation, sick leave and day off states.
- Dashboard aggregate backend contract is tracked separately; current frontend aggregation is transitional and must not become the long-term source of truth.
