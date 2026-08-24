# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the implementation request: Next.js App Router with TypeScript, React, Node.js built-in SQLite, and Playwright browser acceptance tests. The primary local command binds to loopback and uses a user-controlled data directory.

## Users

Radar serves one person running an open-source instance on a device they control. They describe a concern in natural language, periodically inspect what Radar acquired and judged, and turn selected intelligence into traceable outputs without creating a Radar account.

## Product Purpose

Radar turns a long-running natural-language concern into a private intelligence workspace. Success means a user can acquire source material, inspect evidence-backed judgments, and generate a portable output while retaining custody of the application, data, assets, and credentials.

## Positioning

Radar accumulates durable judgments rather than presenting a feed: source content remains evidence, each Radar Project judges shared source versions independently, and downstream Reports and platform material packages preserve fixed, navigable provenance.

## Operating Context

- The application runs locally in a browser and defaults to a single user with no login.
- The walking skeleton is operated manually: create a Radar Project, add and collect a public RSS/Atom source, run Agent judgment, inspect intelligence, select it for a Report, then preview and download an HTML platform material package.
- The Source Network owns acquired source versions at the Radar-instance boundary. Radar Briefs, Signals, intelligence items, Reports, and their histories belong to one Radar Project.
- Empty results, in-progress work, success, and failures are distinct inspectable states at each workflow boundary.

## Capabilities and Constraints

- One documented primary startup command; the Web server listens on loopback by default.
- Persistent domain data and generated assets live in a user-controlled local directory and survive process restarts.
- Public RSS/Atom is the only source type in the walking skeleton; acquisition is explicit and idempotent.
- One vendor-neutral Agent boundary supports deterministic fixtures and a minimal local adapter. Secrets remain environment configuration and never enter domain records or downloads.
- Intelligence items are judgments with stable identities and revisions, not feed entries.
- Each Report fixes selected intelligence revisions, source cutoff, purpose, audience, angle, and generation context.
- HTML platform material packages have identities separate from Reports and separate generation attempts.
- Downloaded packages are self-contained, semantic, mobile-readable, traceable, and include local assets, manifest, renderer-independent structure, citations, and a PNG preview.
- Authentication, tenants, remote exposure, scheduling, publishing, generic plugins, and additional source or output types are outside this slice.

## Brand Commitments

The product name is Radar. Product language follows `CONTEXT.md`, retaining terms such as Radar Project, Radar Brief, Source Network, Signal, 情报条目, Report, and 平台物料包 without replacing them with feed-reader terminology. The existing product handoff and Radar Brief prototype are incumbent visual evidence: warm paper-like neutrals, ink, restrained deep green, clear provenance, and an editorial workbench character.

## Evidence on Hand

- Domain vocabulary and product decisions: `CONTEXT.md` and `docs/adr/`.
- End-to-end scope and acceptance behavior: GitHub issues #22–#29.
- Existing visual and interaction evidence: `docs/radar-product-handoff.html` and `prototypes/radar-brief-prototype.html`.
- Prior-art research: `docs/research/`.
- No customer claims, production benchmarks, testimonials, hosted service, or approved brand assets exist; future surfaces must not fabricate them.

## Product Principles

- Local ownership is the default, not an export afterthought.
- Preserve evidence and identity boundaries so every downstream judgment can be explained.
- Share acquired source facts across Projects while isolating every Project-owned judgment.
- Build the shortest usable end-to-end slice before adding workflow breadth.
- Make valid emptiness and recoverable failure as legible as success.

## Accessibility & Inclusion

The Web UI and generated HTML use semantic structure, keyboard-operable controls, visible focus, readable contrast, informative text alternatives, and responsive layouts that remain usable at mobile viewport sizes. Dynamic status changes are announced without relying on color alone.
