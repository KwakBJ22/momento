# AGENTS.md

# Momento Development Rules

This repository is developed under an MVP-first philosophy.

Your highest priority is to complete working features quickly with the smallest possible changes.

---

# Core Principles

- MVP first.
- Shipping is more important than perfection.
- Prefer working software over ideal architecture.
- Preserve existing code whenever possible.
- Make the smallest change that solves the problem.
- Do not introduce unnecessary abstractions.
- Do not refactor unless it directly fixes the requested task.
- Avoid large-scale restructuring.

---

# Autonomous Decision Making

Do not ask the user for confirmation.

When multiple reasonable solutions exist:

- choose the smallest implementation
- choose the least risky implementation
- choose the implementation that preserves existing code
- continue working without waiting for approval

Assume reasonable defaults.

The user prefers progress over discussion.

---

# When Questions Are Allowed

Only interrupt the user when the task is impossible to complete.

Examples:

- repository access unavailable
- required API key or secret missing
- required external service unavailable
- impossible to infer missing mandatory information

Do NOT ask questions for:

- implementation style
- naming
- folder organization
- UI details
- refactoring
- optimization
- architecture preference

Choose the most conservative option yourself.

---

# Code Changes

Always:

- modify the minimum number of files
- preserve current architecture
- reuse existing components
- avoid duplicate code
- avoid introducing new dependencies unless absolutely necessary

Never rewrite working code.

---

# UI Rules

The project values simplicity.

Do not redesign screens unless explicitly requested.

For UI work:

- keep existing layout
- improve spacing only when necessary
- reuse current components
- preserve mobile-first behavior
- keep interactions simple

No unnecessary animations.

No unnecessary visual effects.

---

# Product Philosophy

Momento is a memory-sharing service.

Priorities:

1. usability
2. speed
3. emotional experience
4. visual polish

Never sacrifice usability for aesthetics.

---

# Copywriting

Avoid technical wording.

Avoid exposing AI to users.

Write from the user's perspective.

Use warm and natural language.

---

# Validation

After changes:

- run only the necessary validation
- avoid unnecessary test suites
- verify only affected functionality

Preferred order:

1. TypeScript check
2. Production build
3. Targeted runtime verification

---

# Deployment Verification

A successful git push does not mean production is updated.

For production tasks, always verify:

- origin/main commit hash
- Vercel production deployment commit hash
- production alias points to the latest deployment
- actual production URL reflects the requested change

Do not report deployment complete until all four are confirmed.

---

# Git Workflow

For normal local fixes:

- implement
- validate locally
- commit

For features requiring mobile, external URL, or sharing tests:

- create or reuse a short-lived feature branch
- implement and validate locally
- commit and push the feature branch
- use the Vercel Preview deployment for external testing
- do not merge into main until preview testing is complete

For urgent production bug fixes:

- fix on main
- validate
- commit
- push immediately

Do not deploy unfinished UI changes directly to production.

---

# Response Format

After completing work, report only:

- Root cause
- Files modified
- What changed
- Validation performed
- Commit hash
- Push result

Keep reports concise.

---

# Performance

Always prefer:

small changes
low risk
fast implementation

over

perfect architecture
large refactoring
future-proofing

---

# Project Context

Momento is currently in MVP.

The objective is to release quickly and improve based on real user feedback.

Every decision should support rapid iteration.