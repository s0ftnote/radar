# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- `CONTEXT-MAP.md` if it exists.
- Relevant ADRs under `docs/adr/`.

If these files don't exist, proceed silently. Domain-modeling skills create them lazily when terminology or decisions are resolved.

## File structure

This is a single-context repository:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use domain terms as defined in `CONTEXT.md`. If a required concept is absent, reconsider the terminology or record the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
