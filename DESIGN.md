---
name: Radar
description: A warm-paper editorial workbench for a private, local-first Radar Brief station.
colors:
  canvas: "#f6f5f1"
  surface: "#ffffff"
  ink: "#1e211e"
  muted-ink: "#656961"
  line: "#ddded7"
  line-strong: "#c8cac1"
  action-green: "#24664a"
  action-green-hover: "#1d553d"
  health-green-soft: "#e4efe8"
  health-green-ink: "#184b35"
  focus-green: "#2f7556"
  workbench: "#232823"
  workbench-text: "#f7f8f5"
  workbench-muted: "#bfc5bd"
  field: "#fbfcfa"
  field-border: "#747b72"
  field-border-hover: "#a3aaa1"
  field-border-focus: "#91bca5"
  success-text: "#b7d8c5"
  success-line: "#7fbea0"
  error-text: "#ffc1b8"
  skeleton: "#e8e7e2"
typography:
  display:
    fontFamily: "var(--font-editorial), Songti SC, Noto Serif CJK SC, serif"
    fontSize: "38px"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Noto Sans CJK SC, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Noto Sans CJK SC, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Noto Sans CJK SC, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Noto Sans CJK SC, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.6
rounded:
  compact: "8px"
  field: "10px"
  surface: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "38px"
components:
  button-primary:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.action-green-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
  surface-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  creation-workbench:
    backgroundColor: "{colors.workbench}"
    textColor: "{colors.workbench-text}"
    rounded: "{rounded.surface}"
    padding: "24px"
  status-ready:
    backgroundColor: "{colors.health-green-soft}"
    textColor: "{colors.health-green-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
---

# Design System: Radar

## Overview

**Creative North Star: "The Editorial Investigation Desk"**

Radar is an Operate-mode workbench with the calm authority of a well-kept research desk. Warm paper surrounds precise white evidence surfaces, while the charcoal creation panel feels like the active instrument on that desk. The interface is restrained and information-led: identity and provenance remain legible, controls feel deliberate, and valid emptiness receives the same compositional care as populated states.

Brand expression is concentrated rather than spread everywhere. The self-hosted ZCOOL XiaoWei face gives the Radar wordmark and page-level headings an editorial voice; the rest of the workbench uses a durable system sans stack for fast scanning and mixed Chinese/Latin content. Deep green is reserved for action, focus, health, and authored directional affordances—not decoration. The incumbent visual evidence remains `docs/prototypes/radar-brief-prototype.html` and `docs/radar-product-handoff.html`; the shipped implementation is the normative source for exact values.

**Key Characteristics:**

- Warm paper canvas with flat white, hairline-bordered reading surfaces.
- One dark creation workbench that clearly distinguishes making from inspecting.
- Editorial display type used sparingly; system sans carries operational content.
- Deep green communicates action, focus, health, and forward movement.
- Responsive topology puts creation before the Brief list on narrow screens.
- Surface seed `e2d76f24` identifies this implemented visual direction.

## Colors

The palette is a warm neutral field with near-black ink and a single restrained deep-green semantic accent.

### Primary

- **Action Green:** The only strong accent, used for primary actions, row direction, text selection, focus-adjacent states, and running/ready health signals.
- **Action Green Hover:** A deeper interaction state for primary actions; it reinforces intent without introducing a new hue.

### Neutral

- **Warm Paper:** The application canvas; it keeps the workspace quiet and materially distinct from white documents.
- **Evidence White:** The reading surface for lists, briefs, next steps, fields, and fatal states.
- **Workbench Charcoal:** The creation surface; it visually separates active authorship from passive inspection.
- **Ink:** Primary text and structural contrast.
- **Muted Ink:** Explanations, metadata, dates, and secondary navigation.
- **Hairline / Strong Hairline:** Borders provide structure in place of shadows, with the stronger value reserved for shell boundaries.

### Named Rules

**The Green Means Something Rule.** Deep green is reserved for action, health, focus, and directional affordances; never use it as ambient decoration.

**The Paper and Instrument Rule.** Reading and evidence live on white paper-like surfaces; the dark workbench is reserved for creation.

## Typography

**Display Font:** ZCOOL XiaoWei, self-hosted, with Songti SC, Noto Serif CJK SC, and generic serif fallbacks.

**Body Font:** The native system sans stack, including PingFang SC and Noto Sans CJK SC fallbacks.

**Character:** The display face adds a measured Chinese editorial cadence, while the sans stack keeps the product operational, compact, and resilient across platforms. Mixed Chinese and English terminology is treated as working language, not decorative typesetting.

### Hierarchy

- **Display** (400, 38px, 1.12): Page-level `h1` only; it drops to 31px below 820px and stays within roughly 18 characters.
- **Headline** (400, 24px, 1.5): Long-form Radar Brief content; it drops to 21px below 820px.
- **Title** (700, 17px, 1.3): Panel and section headings; nearby empty-state titles rise to 19px where needed.
- **Body** (400, 15px, 1.6): Default operational copy. Introductory summaries use 16px and remain near 68 characters wide.
- **Label** (650, 13px): Field labels and compact status copy. Shell metadata uses 11px, 0.09em tracking, and uppercase Latin text.

### Named Rules

**The Two-Voice Rule.** ZCOOL XiaoWei belongs only to the Radar wordmark and page-level `h1`; every workbench control, section title, datum, and paragraph stays in the system sans.

## Layout

The shell is centered at a maximum width of 1180px with 20px side clearance on desktop. A restrained masthead and footer form horizontal evidence boundaries. Main content uses 68px top and 84px bottom padding, with page headings separated from work areas by 38px.

At desktop widths, the primary workspace is a two-column grid: the inspection area receives roughly twice the space of the creation workbench (`1.55fr / 0.8fr`), with a 24px gutter and a 320px minimum for the right column. The creation workbench sticks 24px from the viewport top while scrolling. Cards normally use 24px internal padding; the Brief document uses 28px.

Below 820px the shell narrows to 14px side clearance, the page rhythm compresses, and every two-column work area becomes one column. On the home screen the creation workbench explicitly moves to grid row one, ahead of the Radar Brief list. Heading groups stack, dates can disappear from Brief rows, provenance pairs become one-column, and the footer becomes a short vertical stack. Below 460px panel padding reduces to 20px and Brief summaries may wrap.

**The Creation-Before-List Rule.** Narrow screens must show the creation workbench before the existing-Brief list; this ordering is a product topology, not a cosmetic rearrangement.

## Elevation & Depth

Radar is flat by default and uses no card shadows. Depth comes from material contrast: warm canvas, white bordered evidence surfaces, and the solid charcoal workbench. The only resting halo is the soft green ring around the tiny running-status dot; the only animated shimmer belongs to loading skeletons.

### Named Rules

**The Border-Built Depth Rule.** Use one-pixel hairlines and tonal separation for structure; do not add ambient card shadows.

## Shapes

The form language is gently rounded and practical. Major panels use 14px corners, fields use 10px corners, and compact floating utilities use 8px. Buttons and status badges are full pills. The running-status indicator is circular. Borders are thin and visible; shapes do not rely on clipping or ornamental geometry.

The authored Brief-row arrow is a 20px inline SVG with rounded stroke caps and joins. Its simple rightward line is the recurring directional silhouette and shifts 3px on hover.

## Components

### Buttons

- **Shape:** Full pill with a 42px minimum height and compact 9px by 16px padding.
- **Primary:** White, bold sans text on Action Green; the button expands to the available width inside the creation workbench.
- **Hover / Focus:** Hover deepens the green and lifts by 1px; active returns to rest. Keyboard focus uses a three-pixel translucent green outline with a three-pixel offset.
- **Disabled:** Keeps its semantic color but drops to 58% opacity, removes the lift, and uses a wait cursor.

### Cards / Containers

- **Corner Style:** Gently rounded major surfaces (14px).
- **Background:** Evidence White for reading and inspection; Workbench Charcoal for the create-brief surface.
- **Shadow Strategy:** None; use canvas contrast and one-pixel borders.
- **Border:** Standard Hairline for panels; the dark workbench matches border and fill.
- **Internal Padding:** 24px normally, 28px for the Brief document, and 20px on the narrowest screens.

### Inputs / Fields

- **Style:** Near-white field fill, medium neutral border, 10px corners, dark ink, and green caret. Inputs are at least 44px tall; textareas are at least 130px and resize vertically.
- **Hover / Focus:** Hover lightens the border. Focus moves to a softened green border with a translucent three-pixel green outline.
- **Error / Disabled:** Errors are announced in text and use pale red against the dark workbench; no state relies on color alone.

### Navigation

The masthead is deliberately spare: Radar wordmark at left, compact uppercase local-instance context at right, separated from content by a strong hairline. On mobile, secondary wordmark and instance metadata disappear before the identity does. Detail pages use a small, muted breadcrumb whose links move to Health Green Ink on hover.

### Brief Rows

Rows are border-separated links with a strong title, a truncating or wrapping Brief summary, compact date metadata, and an authored SVG arrow. Hover changes the row text toward green and translates only the arrow by 3px; the affordance remains legible without motion.

### Status and Confirmation

Running and ready states pair green text with a dot, halo, or soft badge rather than color alone. Form messaging reserves a minimum 24px line to avoid layout shift. Only a successful save draws the 36px confirmation line, scaling from the left over 420ms with a decisive ease-out curve. Error and idle states never receive that flourish. Under reduced-motion preferences the line remains visible in its final state because animations and transitions are disabled globally.

### Loading

Loading uses rounded neutral skeleton blocks with a restrained white sweep. The skeleton geometry mirrors the heading and two-panel work area, and all shimmer stops under reduced-motion preferences.

## Do's and Don'ts

### Do:

- **Do** preserve the Operate-mode hierarchy: task completion, scanability, and inspectable state come before brand theater.
- **Do** keep ZCOOL XiaoWei self-hosted and confined to the Radar wordmark and page-level headings.
- **Do** use white bordered surfaces for evidence and the charcoal surface for creation.
- **Do** keep deep green semantic and rare: action, focus, health, and forward direction only.
- **Do** preserve the creation-before-list mobile topology and the authored SVG row affordance.
- **Do** keep every transition meaningful and provide the global reduced-motion fallback.

### Don't:

- **Don't** add ambient shadows, gradients, glass effects, or decorative green washes.
- **Don't** apply the editorial face to controls, metadata, body copy, or dense workbench content.
- **Don't** convert the Brief list into a feed or flatten provenance into anonymous metadata.
- **Don't** animate error or idle messages with the success confirmation line.
- **Don't** replace the implemented system based only on the evidence prototypes; use them as preserved lineage and the shipped code as exact ground truth.
