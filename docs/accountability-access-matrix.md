# Accountability Access Matrix

Backend permissions are the source of truth. Role rows below describe the
canonical production bindings; direct permissions use the same checks.

| Role | Own account | View all | Issue funds | Review expenses | Approve closure | Correct receipts |
| --- | --- | --- | --- | --- | --- | --- |
| `founder` | Only when otherwise eligible | `accountability.review` | `accountability.issue_cash` | `expense.approve` | `accountability.closure.approve` | `accountability.correct_receipt` |
| `director` | Only when otherwise eligible | `accountability.review` | `accountability.issue_cash` | `expense.approve` | `accountability.closure.approve` | `accountability.correct_receipt` |
| `deputy_founder` | Only when otherwise eligible | `accountability.review` | No | `expense.approve` | `accountability.closure.approve` | No |
| `corporate_director` | Only when otherwise eligible | `accountability.review` | No | `expense.approve` | `accountability.closure.approve` | No |
| `deputy_director` | Only when otherwise eligible | No | No | No | No | No |
| `manager`, `senior_manager`, `operation_manager` | Yes | No | No | No | No | No |
| `hr` | Only with active one-time assignment or historical receipt | No | No | No | No | No |

Own-account eligibility also applies to an active `one_time_manager` assignment
or ownership of historical `one_time_order_receipt` funding. General order read
access never grants access to another user's accountability account.

## Persistence invariants

Posted payments, fundings, and expenses are immutable financial history. Their
order, completion, account, and source relations use `ON DELETE RESTRICT`;
accounts are closed by status rather than physical deletion. Corrections must be
recorded as reversal and replacement entries instead of updating posted values.
