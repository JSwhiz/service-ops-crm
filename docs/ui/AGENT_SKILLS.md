# UI review skills

Two project-local skills support frontend review and implementation. They supplement, and never override, the CRM UI contracts.

## Sources

- `impeccable` — `.agents/skills/impeccable/`; upstream `pbakaus/impeccable`, release `skill-v4.1.1`.
- `vercel-web-design-guidelines` — `.agents/skills/vercel-web-design-guidelines/`; upstream `vercel-labs/agent-skills`, skill `skills/web-design-guidelines`, version `1.0.0`.

## Which one to use

- Use Vercel Web Design Guidelines for a focused code-level checklist: accessibility, keyboard/focus, forms, responsive behavior, motion, typography, localization, and interaction details. Before each review, retrieve the latest rules from the source URL in that skill. Return concrete file/line findings; this skill is an audit, not an implementation request.
- Use Impeccable `audit` for a broader technical UI audit, `critique` for a scoped UX assessment, and `polish` only when asked to implement a specific refinement. For CRM screens select `Operate` mode: scanability, consistency, native interaction expectations, and task completion take priority over novelty.

## Required guardrails

Before any UI review or change, follow `AGENTS.md` and read the required files, especially:

- `docs/ui/STYLE_SOURCES.md`
- `docs/ui/UI_ARCHITECTURE.md`
- `docs/ui/COMPONENT_CONTRACTS.md`
- `docs/ui/MODULE_ROADMAP.md`

Project tokens, shared components, existing navigation, and module contracts are the source of truth. Do not add colors, visual patterns, component APIs, animation, or behavior merely because a skill recommends them. Preserve permissions, calculations, lifecycle, and history. Review findings are read-only unless fixes are explicitly requested; fixes stay within the requested module and roadmap.

Do not enable Impeccable hooks, Live Mode, concept-generation requests, telemetry, external image generation, or automatic update checks as part of routine work. Any such capability needs a separate user request.

## Example requests

- “Review `apps/frontend/src/...` against Vercel Web Design Guidelines; do not edit. Follow the CRM UI contracts and report only actionable findings.”
- “Run Impeccable audit on `<route/component>` as a read-only technical audit. Respect the CRM tokens and component contracts.”
- “Polish `<specific screen>` using existing CRM tokens and shared components only. Keep the current navigation and behavior; verify at the agreed viewport sizes.”
