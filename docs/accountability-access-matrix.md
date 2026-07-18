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

## One-time order receipts

- `accountability.review` and `accountability.correct_receipt` expose all
  completion payments. Other users receive full details only for their own
  receipt, or for an organization payment they recorded; every other payment is
  returned as a restricted placeholder without amount, recipient, method, or
  comment.
- A removed manager retains access to their own historical receipts and may
  report expenses against those receipts. This does not grant access to the
  order card or another user's accountability account.
- Receipt correction requires `accountability.correct_receipt`. Canonical
  production bindings grant it only to `founder` and `director`.
- A correction can keep the historical recipient, use a current active manager,
  or switch to organization. Arbitrary users are never valid recipients.
- A positive manager receipt creates an accountability credit. Organization and
  zero-value payments do not create funding.

## Expense visibility

- The account owner sees their fundings, expenses, closure history, current
  balance, and forecast balance.
- Reviewers see administrative projections for all accounts. Order visibility
  alone never enables this projection.
- Expense linkage to a completion is accepted only when the completion belongs
  to the selected order and the user is its current manager, historical receipt
  recipient, or an accountability reviewer.
- Attachments use the authenticated file proxy and safe public DTO; storage
  bucket and object key are never part of the accountability response.

## Persistence invariants

Posted payments, fundings, and expenses are immutable financial history. Their
order, completion, account, and source relations use `ON DELETE RESTRICT`;
accounts are closed by status rather than physical deletion. Corrections must be
recorded as reversal and replacement entries instead of updating posted values.
Submitted expense amount, description, and financial links are immutable;
expense status transitions remain conditional and transactional.
