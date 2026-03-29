# Access Model

## Core principles

The system separates:

1. base role
2. additional permissions
3. visibility groups
4. approval capabilities

Visibility is not equal to edit rights.

Edit rights are not equal to approval rights.

## Base roles

- founder
- deputy_founder
- director
- deputy_director
- commercial_director
- object_manager
- one_time_manager
- hr
- sys_admin

## Visibility groups

### Object

- object_basic
- object_contacts
- object_financial
- object_salary
- object_consumables
- object_equipment

### One-time order

- order_basic
- order_contacts
- order_financial
- order_expense

## Scope logic

Visibility may be granted with different scopes:

- all
- own
- assigned
- custom

## Important model decisions

- manager of object sees full approved object block set for own objects
- one-time manager sees financial and expense blocks for assigned one-time orders
- HR sees all employees in HR scope
- object and order block visibility is managed in grouped form, not field-by-field in MVP

## Approval capabilities

Examples:

- approve_task_result
- approve_consumables_without_photo
- approve_stock_return
- approve_object_change

## Architecture note

This model is intentionally more flexible than fixed role-only systems, because the business expects exceptions and future reconfiguration without rewriting the whole access layer.
