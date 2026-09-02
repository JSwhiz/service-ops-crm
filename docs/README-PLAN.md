# README editorial direction

This note captures the approved direction for the repository front page before the full README rewrite.

## Audience

The README is simultaneously:

1. the project owner's primary technical/product portfolio presentation;
2. the onboarding entry point for another developer joining the codebase;
3. a product overview understandable to a non-specialist reviewer;
4. an engineering-quality signal for technical reviewers and potential employers/partners.

## Editorial principles

- Product-first, engineering-deep.
- Polished and presentation-ready without decorative badge overload.
- Explain *why* architectural boundaries exist, not only *what* technologies are used.
- Use real business concepts, but no customer names, real object names, personal names, production identifiers, credentials, hostnames or customer data.
- No connection to identifiable real-world customer information in examples.
- Clearly separate implemented runtime behavior from roadmap/design work and unresolved product decisions.
- README is an entry point, not a second Product Contract. Canonical documents remain authoritative.
- Prefer diagrams, compact tables and carefully structured prose over walls of implementation detail.
- Production safety and backend-authoritative access control must be prominent.

## Planned shape

The final README should include:

- hero / product positioning;
- restrained CI/runtime/license badges;
- clickable table of contents;
- product overview and operational problem statement;
- business/domain map;
- architecture and data-flow diagrams;
- explanation of User vs Employee and the role / scoped assignment / capability / approval access model;
- major domain sections and golden paths;
- technology stack;
- repository structure;
- frontend and backend architecture conventions;
- local quick start and detailed development setup;
- environment/configuration guidance without secrets;
- database and migration policy;
- testing and CI quality gates;
- production safety rules;
- canonical documentation index and onboarding reading order;
- ownership and proprietary license notice.

## Language

Primary language: Russian, with standard English engineering terminology where it is the clearer or canonical term. A separate English README may be added later if the repository's public portfolio use warrants it.

## Ownership

Project owner and maintainer attribution should name **Дмитрий Крючков**.

## Branding

The working name remains **Service Ops CRM** until the dedicated branding task is completed. See `docs/BRANDING.md`.
