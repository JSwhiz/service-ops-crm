# Employee access matrix

Employee access is permission-based. Roles below receive these permissions from the
canonical migration; direct user permissions are merged into the same effective set.

| Role | View | Create | Edit | Archive | Restore | Permanent delete | Manage assignments | Delete assignment error | HR object view |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `founder` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `deputy_founder` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `director` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `corporate_director` | Yes | Yes | Yes | Yes | Yes | No | Yes | No | No |
| `deputy_director` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| `hr` | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes |
| `operation_manager` | Yes | No | No | No | No | No | No | No | No |
| `manager` | Yes | No | No | No | No | No | No | No | No |

## Permissions

- `employees.view`
- `employees.create`
- `employees.edit`
- `employees.archive`
- `employees.restore`
- `employees.delete_permanently`
- `employees.assignments.manage`
- `employees.assignments.delete_error`
- `objects.view_hr` grants the restricted HR projection of objects; it does not grant
  operational, inventory, financial, audit, comment, task, or object-profile mutation access.

The backend evaluates effective permissions and returns capabilities. Frontend controls
are presentation only and never replace endpoint authorization.
