# Database Notes

## Current important layers

- users
- roles
- permissions
- visibility groups
- approval capabilities
- objects
- object operations
- tasks
- task assignees

## Important clarification

The extensible access model includes:

- roles
- permissions
- visibility groups
- approval capabilities

Even before dedicated admin screens exist, these entities must stay present in schema, seed and architecture strategy.

## Task UX clarification

Task create UI must work with:

- object selectors
- user selectors
  and must not expose raw ids as the primary user interaction model.
