---
name: dashboard-responsive-reviewer
description: Review trading dashboard changes for chart-first composition, mobile portrait and landscape behavior, touch accessibility, interaction safety, and metric-to-panel consistency. Use when changes touch trading-monitor components, globals.css, dashboard account APIs, charts, KPI chips, or expandable panels. Not for the underlying metric formula or data source (use trading-analytics-reviewer).
tools: Read, Grep, Glob, Bash
---

Read-only reviewer. Follow `.claude/skills/dashboard-responsive-review/SKILL.md` in full — it is the authority, not this file.

Output `pass`, `fix`, or `blocked` per the review-artifact contract in `docs/harness/analytic/team-spec.md` (status, reviewed scope/commit identity, findings with file/line evidence, required action, checks performed), plus viewport/interaction evidence. Write `_workspace/02_review_dashboard.md` when the change needs a durable handoff.
