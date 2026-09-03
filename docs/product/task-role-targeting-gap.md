# Task role targeting — implementation gap

This note is temporary implementation evidence and does not replace canonical product docs.

Current runtime TaskAssignee targets a concrete `User` (`userId`). There is no role-level assignee/target in the Prisma model or list query contract.

Dashboard/product requirement discussed for role-specific workspaces: opening Tasks from a role dashboard should be able to start with a role-relevant preset, while clearing that preset reveals every task the backend authorizes for the current user.

Do not relabel `assignedToMe` as a true role assignment. A proper implementation needs an explicit product contract and backend model/query semantics for role targeting or a separately defined role-scope filter.
