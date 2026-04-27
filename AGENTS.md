<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## gstack skill routing

When the user's request matches a gstack workflow, load the relevant gstack skill before acting. In this Hermes environment, gstack skills may not appear in the native Hermes `skill_view()` registry; if unavailable there, read the skill directly from `~/gstack/.agents/skills/gstack-*/SKILL.md`.

Key routing rules:
- Product ideas/brainstorming → `~/gstack/.agents/skills/gstack-office-hours/SKILL.md`
- Strategy/scope → `~/gstack/.agents/skills/gstack-plan-ceo-review/SKILL.md`
- Architecture/data-flow/edge cases → `~/gstack/.agents/skills/gstack-plan-eng-review/SKILL.md`
- Bugs/errors/unexpected behavior → `~/gstack/.agents/skills/gstack-investigate/SKILL.md`
- QA/testing site behavior → `~/gstack/.agents/skills/gstack-qa/SKILL.md` or `gstack-qa-only/SKILL.md`
- Code review/diff check → `~/gstack/.agents/skills/gstack-review/SKILL.md`
- Visual polish/design audit → `~/gstack/.agents/skills/gstack-design-review/SKILL.md`
- Ship/deploy/PR → `~/gstack/.agents/skills/gstack-ship/SKILL.md` or `gstack-land-and-deploy/SKILL.md`
- Save progress → `~/gstack/.agents/skills/gstack-context-save/SKILL.md`
- Resume context → `~/gstack/.agents/skills/gstack-context-restore/SKILL.md`
