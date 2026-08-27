---
name: Radar
description: An international signal desk where structured editorial order keeps every Brief, source, judgment, and report legible.
colors:
  canvas: "#f4f5f7"
  surface: "#ffffff"
  surface-subtle: "#f7f8fa"
  surface-active: "#eef2f7"
  ink: "#111318"
  muted: "#59616d"
  faint: "#626b76"
  line: "#e1e4e8"
  line-strong: "#cfd4db"
  primary: "#2557d6"
  primary-hover: "#1946bd"
  primary-soft: "#eaf0ff"
  success: "#19704a"
  success-soft: "#e9f6ef"
typography:
  display:
    fontFamily: '"Radar Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "clamp(40px, 4.1vw, 54px)"
    fontWeight: 650
    lineHeight: 1.07
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Radar Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"Radar Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "19px"
    fontWeight: 680
    letterSpacing: "-0.018em"
  body:
    fontFamily: '"Radar Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.58
    letterSpacing: "normal"
  label:
    fontFamily: '"Radar Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif'
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.02em"
rounded:
  control: "9px"
  surface: "14px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "7px"
    padding: "6px 11px"
    height: "36px"
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "8px"
    padding: "9px 12px"
    height: "44px"
  navigation-current:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 11px 0 13px"
    height: "42px"
  skill-command:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "8px"
    padding: "0 10px"
    height: "38px"
  precision-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "6px"
    padding: "4px 8px"
---

# Design System: Radar

## Overview

**Creative North Star: "The International Signal Desk"**

Radar is an international signal-editing system: structured, precise, global, editorial, and restrained. Its neutral gray-white canvas, white precision workbench, graphite text, single deep-blue action color, and entirely sans-serif typography make order, alignment, and information density more important than decoration.

The top workbench keeps Agent commands and live state reachable while every page proceeds through one coherent column grid—from tasks into Briefs, sources, judgments, and reports. The first viewport establishes the title, primary action, and core task content without letting navigation consume the screen; the interface should feel like a durable editorial desk, never a promotional dashboard.

**Key Characteristics:**

- International Grid × Structured Editorial
- Neutral gray-white canvas with crisp white working surfaces
- One deep-blue action voice against graphite information hierarchy
- Flat, border-defined structure with selective functional elevation
- Restrained column-by-column reveal that yields to reduced-motion preferences

## Colors

The palette is a cool neutral editorial field with one concentrated deep-blue action voice and a reserved green for verified success.

### Primary

- **Signal Blue:** The sole interactive accent for primary actions, links, selection, focus, and purposeful hover states; its darker state is reserved for hover and its pale field for quiet interactive emphasis.

### Secondary

- **Verified Green:** Positive or selected semantic state, paired with a pale green field and never used as a general accent.

### Neutral

- **Canvas Gray:** The application field behind all working surfaces.
- **Precision White:** The workbench, forms, sheets, and other primary surfaces.
- **Subtle Paper and Active Gray:** Quiet hover, code, tag, selected-navigation, and low-emphasis state fields.
- **Graphite Ink:** Primary headings and essential content.
- **Operational Gray and Faint Gray:** Supporting copy, metadata, labels, and hierarchy that must remain readable without competing with the task.
- **Hairline and Strong Hairline:** Default surface division and the firmer control boundary.

### Named Rules

**The One Signal Rule.** Deep blue is the only general action color; green remains semantic, and neutral surfaces carry the rest of the hierarchy.

**The Neutral Field Rule.** Keep large areas gray-white or white so content density reads as organized information, not visual noise.

## Typography

**Display Font:** Radar Geist, with PingFang SC, Noto Sans CJK SC, Microsoft YaHei UI, and sans-serif fallbacks

**Body Font:** Radar Geist, with PingFang SC, Noto Sans CJK SC, Microsoft YaHei UI, and sans-serif fallbacks

**Character:** Radar Geist is locally self-hosted as a variable face for Latin characters; Chinese text deliberately falls through to the native CJK sans-serif stack. The result is compact, contemporary, and globally legible without mixing serif display gestures into an operational product.

### Hierarchy

- **Display** (650, fluid 40–54px, 1.07): Page and document titles; tightly tracked and limited to roughly 24 characters per line.
- **Headline** (650, 24px): Empty states and substantial local headings.
- **Title** (680, 19px): Task names and high-value row titles.
- **Body** (400, 15px, 1.58): General interface and prose; sustained reading stays near 68–72 characters per line.
- **Label** (650, 11px, 0.02em): Metadata, state, compact controls, and column labels; preserve natural case instead of forcing uppercase.

### Named Rules

**The Sans-Only Rule.** Use the shared sans-serif stack for both Chinese and Latin; hierarchy comes from scale, weight, spacing, and alignment rather than a decorative type family.

## Layout

The desktop workspace is a unified editorial column system. A sticky workbench sits near the top edge with a 68px minimum height; it may stretch to 1320px, while page content is capped at 1240px and enters with 72px of top space. Page headings align titles, supporting text, and a primary action on the same horizontal logic; sheets and row lists inherit that grid instead of becoming independent Bento islands.

The first viewport must establish the light workbench, title hierarchy, primary action, and core task content as one composition. Desktop information rows use explicit columns and 1px dividers; page reading measures remain near 68–72ch. Repeated spacing uses a compact 4/8/12/16/20/24/32px rhythm, with larger section gaps used only to separate editorial chapters.

Responsive changes are structural at 1120px, 900px, 767px, and 460px. Secondary task metadata collapses first, then multi-column task and judgment layouts become single-column. At 767px the workbench becomes a compact grid rather than a sidebar: brand, navigation, and live state occupy the first row, while all three Skill commands remain visible beneath it with both path and “复制”. The workspace edge contracts, primary actions move into document flow, and forms become viewport-contained overlays.

The signature motion is a restrained grid reveal: content rises 12px while opacity resolves over 420–500ms with cubic-bezier(0.32, 0.72, 0, 1), staggered lightly by column order. Disable transitions and reveal transforms completely when reduced motion is requested.

### Named Rules

**The One Grid Rule.** Every surface must align to the workspace and its local columns; do not create offset islands merely to add visual variety.

**The Reachable Agent Rule.** Agent commands and live sync state remain directly reachable at every viewport, including all three command paths on mobile.

## Elevation & Depth

Radar is flat by default. White surfaces separate from the cool canvas through a 1px neutral boundary, not shadow; rows separate through hairlines and tonal hover fields. Elevation is functional and scarce: the blue primary action receives a small colored lift, while menus, forms, and toast notices use a stronger floating shadow because they temporarily sit above the document plane.

### Shadow Vocabulary

- **Ambient Low** (0 8px 24px rgba(18, 24, 32, 0.055)): Reserved low-level ambient depth token; never required for ordinary sheets.
- **Primary Action Lift** (0 5px 14px rgba(37, 87, 214, 0.16)): Gives the one decisive action a controlled blue lift; hover strengthens it slightly.
- **Floating Layer** (0 14px 38px rgba(18, 24, 32, 0.11)): Menus, form overlays, and toast notices only.

### Named Rules

**The Flat-by-Default Rule.** Resting surfaces use borders and tonal contrast; shadows indicate action or temporary elevation, never ordinary grouping.

## Shapes

The form language is gently rectilinear: precision surfaces use a 14px radius, standard buttons use 9px, and compact controls step down to 7–8px. Borders are 1px and quiet. Small status markers and tags may use 5–6px corners; only the live connection dot is circular. Pills are not a general-purpose visual language.

### Named Rules

**The Controlled Radius Rule.** Corners communicate scale—14px for surfaces, 9px for primary controls, and smaller radii for dense metadata—without turning the interface into stacked soft shells.

## Components

Components are precise, restrained, and stateful. Their hierarchy comes from fill, line, text weight, and alignment before shadow or ornament.

### Buttons

- **Shape:** Compact rectangular controls with a 9px primary radius and 7–8px for smaller secondary controls.
- **Primary:** Signal Blue fill, white label, 44px minimum height, and 9px by 15px padding; use for the single decisive action in a region.
- **Hover / Focus:** Hover darkens to the dedicated blue hover state, lifts by 1px, and strengthens the blue shadow; focus-visible uses a clear blue ring and active returns to the baseline.
- **Secondary / Text:** Secondary controls are white with a strong neutral hairline and turn pale blue on hover; text actions remain unfilled and use Signal Blue.

### Chips

- **Style:** Compact 5–6px-radius fields with 10–11px labels. Neutral chips use Active Gray; verified status uses pale green with green text.
- **State:** Text must name the state; color never carries meaning alone. Do not inflate chips into decorative pills.

### Cards / Containers

- **Corner Style:** Gently curved precision surfaces with a 14px radius.
- **Background:** Precision White on Canvas Gray.
- **Shadow Strategy:** Flat at rest; refer to the Flat-by-Default Rule.
- **Border:** One quiet neutral hairline.
- **Internal Padding:** Usually 20–30px, tightening to about 20–23px on mobile.

### Inputs / Fields

- **Style:** White field, 1px strong hairline, 8px radius, 44px minimum height, and 9px by 12px padding.
- **Focus:** Signal Blue border plus a restrained 3px translucent blue ring; caret also uses Signal Blue.
- **Disabled:** Lower opacity while retaining the control silhouette and readable text.

### Navigation

The white top workbench contains the Radar wordmark, task/source navigation, Agent command dock, and live state. Navigation links are muted at rest, receive a subtle neutral hover field, and use an Active Gray field with stronger text for the current section. On mobile it becomes a two-row compact grid; it never turns into a dark side island or hides the three Agent commands.

### Skill Command

The Skill command is Radar’s signature bridge back to the user’s Agent. It is a quiet gray command tile that reveals the blue action voice on hover; every mobile instance displays the full path and “复制”, with a status toast confirming the result.

### Editorial Row

Task, document, report, and source rows share a disciplined pattern: primary title first, supporting metadata in aligned columns, 1px dividers between peers, and a quiet tonal hover. On narrow screens, low-priority columns disappear in a defined order while title and state remain legible.

## Do's and Don'ts

### Do:

- Do align headings, actions, rows, sheets, and metadata to one coherent editorial grid.
- Do reserve deep blue for interactive intent and green for explicit success or selected semantics.
- Do keep resting surfaces flat with 1px boundaries and use elevation only for primary action or temporary floating layers.
- Do preserve all three Agent Skill paths plus “复制” in the compact mobile workbench.
- Do disable reveal motion completely for reduced-motion users and keep state meaning available in text.

### Don't:

- Don't introduce a dark oversized side island, mint green palette, or competing accent colors.
- Don't stack double soft shells, heavy shadows, excessive rounding, or generic pills around ordinary content.
- Don't use offset Bento compositions or decorative asymmetry that breaks the shared column grid.
- Don't let decoration, motion, or navigation displace the first viewport's title, primary action, and core task content.
- Don't use serif display typography or ornament that makes the product feel promotional, low-grade, or visually noisy.
