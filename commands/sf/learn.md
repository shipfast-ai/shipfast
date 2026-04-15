---
name: sf:learn
description: "Manually teach ShipFast a pattern or lesson."
argument-hint: "<pattern>: <lesson>"
allowed-tools:
  - Read
  - Bash
---

<objective>
Manually add a learning to brain.db. Used when you discover a pattern,
gotcha, or convention that ShipFast should remember for future tasks.
</objective>

<process>

## Parse Input

Expected format: `pattern: lesson`
- Pattern: short identifier (e.g., "react-19-refs", "prisma-json-fields", "tailwind-v4-imports")
- Lesson: what to do or avoid (e.g., "Use callback refs, not string refs", "Always use @import not @tailwind")

If format is unclear, ask the user to clarify.

## Extract Domain

Detect domain from the pattern name:
- react/vue/svelte -> frontend
- prisma/drizzle/sql -> database
- auth/jwt/session -> auth
- etc.

## Store in brain.db

Insert into learnings table with:
- pattern: the identifier
- problem: empty (user-taught, not failure-derived)
- solution: the lesson text
- domain: detected domain
- source: 'user'
- confidence: 0.8 (user-taught starts high)

## Confirm

```
Learned: [pattern] -> [lesson]
Domain: [domain] | Confidence: 0.8 | Source: user
```

</process>

<context>
$ARGUMENTS
</context>
