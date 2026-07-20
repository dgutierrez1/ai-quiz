---
name: ai-quiz
description: Turns any public Markdown document into a grounded comprehension session. shadcn/ui on Next.js 15 + Tailwind 4; this DESIGN.md specifies the brand-layer delta only.
status: final
updated: 2026-07-19
colors:
  # Brand overrides on top of shadcn defaults. Unlisted shadcn tokens
  # (popover, card, input, destructive, …) inherit unchanged.
  # Every value below is contrast-verified — see ## Colors.
  surface-base: '#FAF8F5'
  surface-raised: '#FFFFFF'
  surface-sunken: '#F1EDE7'
  ink: '#2A2723'
  ink-muted: '#6B655D'
  primary: '#3F6B7D'
  primary-foreground: '#FFFFFF'
  accent: '#A85A2B'
  accent-foreground: '#FFFFFF'
  strength-strong: '#4A7C59'
  strength-mixed: '#8A6420'
  strength-weak: '#A8574B'
  strength-foreground: '#FFFFFF'
  surface-base-dark: '#1A1815'
  surface-raised-dark: '#232019'
  surface-sunken-dark: '#141210'
  ink-dark: '#EDE9E2'
  ink-muted-dark: '#A39C91'
  primary-dark: '#8FB8CC'
  primary-foreground-dark: '#1A1815'
  accent-dark: '#E29B6B'
  accent-foreground-dark: '#1A1815'
  strength-strong-dark: '#86B894'
  strength-mixed-dark: '#DCB46A'
  strength-weak-dark: '#D89185'
  strength-foreground-dark: '#1A1815'
typography:
  # Body / label / caption inherit shadcn's Geist Sans ramp.
  # Only `reading` and `display` are brand-overridden.
  display:
    fontFamily: 'Geist Sans'
    fontSize: 30px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  score:
    fontFamily: 'Geist Sans'
    fontSize: 56px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: -0.02em
  reading:
    fontFamily: 'Geist Sans'
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.65'
  question:
    fontFamily: 'Geist Sans'
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.5'
  code:
    fontFamily: 'Geist Mono'
    fontSize: 14px
    lineHeight: '1.6'
rounded:
  # Softer than shadcn defaults — ai-quiz reads calmer, not sharper.
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
spacing:
  # Tailwind 4 default scale inherited. Named tokens only.
  reading-measure: 68ch
  panel-gutter: 32px
  card-padding: 24px
  option-gap: 12px
components:
  answer-option:
    background: '{colors.surface-raised}'
    border: '1px solid {colors.surface-sunken}'
    radius: '{rounded.md}'
    padding: '16px'
    minHeight: '48px'
  answer-option-selected:
    background: '{colors.surface-sunken}'
    border: '2px solid {colors.primary}'
    radius: '{rounded.md}'
  strength-chip:
    radius: '{rounded.full}'
    foreground: '{colors.strength-foreground}'
    padding: '4px 12px'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
    minHeight: '44px'
  chat-message-user:
    background: '{colors.surface-sunken}'
    radius: '{rounded.lg}'
  chat-message-assistant:
    background: 'transparent'
    foreground: '{colors.ink}'
  focus-ring:
    color: '{colors.accent}'
    width: '2px'
    offset: '2px'
---

## Brand & Style

ai-quiz turns a document you just read into a check on whether you actually absorbed it. The emotional risk in that premise is obvious: a tool that scores you can very easily feel like a tool that _judges_ you. The entire visual posture exists to defuse that.

The surface is a **calm study surface** — warm paper neutrals, generous whitespace, a comfortable reading measure, restrained motion. It should read like a well-set page you'd willingly sit with at 11pm, not like an exam portal and not like a game. The governing sentence, which every visual decision below answers to:

> **A wrong answer is information, not judgment.**

That is why there is no red in this system. The weakest category renders in a muted clay, not an alarm color — because "you're weak in Streaming" is the single most _useful_ output the product produces, and punishing it visually teaches the user to avoid the thing that helps them.

ai-quiz inherits shadcn/ui wholesale. This file specifies only the brand-layer delta: warm surfaces, a calm slate-teal primary, a single terracotta accent, softer corners, and the handful of components the product actually invents (answer options, strength chips, the score reveal). Components that ship from shadcn — `Button`, `Card`, `Dialog`, `Sheet`, `Tabs`, `Select`, `Skeleton`, `Toast` — inherit as-is. Customizing them is against the discipline.

> **Stack note.** Tailwind **4.3.3** (Oxide, CSS-first) — v3 idioms do not carry over; tokens are declared in CSS via `@theme`, not in `tailwind.config.js`. Motion is `motion` **12.42.2**, imported from `motion/react`, _not_ `framer-motion`.

## Colors

Every ratio below was computed, not estimated. All body-text pairings meet **WCAG 2.2 AA (≥4.5:1)**; UI-component and large-text pairings meet **≥3:1**.

**Surfaces.** `{colors.surface-base}` `#FAF8F5` is warm paper — the default page. `{colors.surface-raised}` `#FFFFFF` lifts cards and answer options off it. `{colors.surface-sunken}` `#F1EDE7` recedes: selected options, user chat bubbles, panel backing. The warmth is deliberate — a pure grey neutral reads clinical, and clinical is the thing we're avoiding.

**Ink.** `{colors.ink}` `#2A2723` is a warm near-black, **14.02:1** on paper. `{colors.ink-muted}` `#6B655D` carries metadata, timestamps, and helper copy at **5.44:1** on paper and **4.94:1** on sunken — both pass AA as true body text, so muted copy is never a contrast compromise.

**Primary — Slate Teal `#3F6B7D`.** The structural brand color: primary buttons, active tabs, selected-option borders, progress fill, links. **5.49:1** on paper; `{colors.primary-foreground}` white sits on it at **5.82:1**.

**Accent — Terracotta `#A85A2B`.** **4.76:1** on paper, white on it at **5.05:1**. Warm, human, and used _sparingly_: the focus ring, and the single most important call to action on any surface. Never decorative, never for state, never a second brand color.

**Strength scale.** Three colors, mapped to the API's `strong | mixed | weak` on `categoryBreakdown[]`:

- **`{colors.strength-strong}` Moss `#4A7C59`** — **4.59:1** on paper. Muted, not a success green. You did well; that isn't a celebration.
- **`{colors.strength-mixed}` Ochre `#8A6420`** — **5.05:1** on paper, **4.59:1** on sunken.
- **`{colors.strength-weak}` Clay `#A8574B`** — **4.80:1** on paper. **This is not red and must never be swapped for one.** It is warm, low-saturation, and sits at the same visual weight as moss. A user scanning their results should not be able to tell at a glance whether they did well or badly _by color temperature alone_ — they should have to read it. That is the point.

Because strength chips sit on varying backgrounds, they render as **solid fill with `{colors.strength-foreground}` white text** — verified at 4.86:1 (moss), 5.35:1 (ochre), 5.08:1 (clay). Never tinted-background-with-colored-text; that pairing drops below AA on sunken surfaces.

**Dark mode.** Every `-dark` token clears AA against `{colors.surface-base-dark}` with headroom (6.5:1 to 14.6:1). Dark surfaces stay warm-tinted (`#1A1815`, not `#000000`) — the study-lamp quality survives the theme switch.

**Never introduce:** a destructive red anywhere outside shadcn's own `destructive` token (reserved for genuinely destructive actions, of which v1 has none); gradients; more than one accent; color as the _sole_ carrier of any meaning.

## Typography

Body, label, and caption inherit shadcn's **Geist Sans** ramp. Four roles are brand-added:

- **`{typography.reading}`** 17px / 1.65 — the workhorse. Chat messages, explanations, insight narrative. Deliberately larger and looser than a typical app body: this is prose the user is _reading to learn_, not scanning. Constrained to `{spacing.reading-measure}` (68ch).
- **`{typography.question}`** 20px / 500 / 1.5 — question text on `/quiz/[id]`. One notch up from reading, because it's the single thing on screen that matters.
- **`{typography.score}`** 56px / 600 — the final score, and nothing else in the product. Its scale _is_ the reveal.
- **`{typography.display}`** 30px / 600 — page headings and empty-state heroes.
- **`{typography.code}`** Geist Mono 14px — inline code and fenced blocks inside explanations and chat. Technical READMEs are the source material; API names, flags, and snippets must survive rendering legibly.

Minimum rendered size anywhere is **14px**. No 12px metadata.

## Layout & Spacing

Tailwind 4's default scale is inherited. Named tokens carry the product-specific rhythm: `{spacing.reading-measure}` (68ch) caps every prose column; `{spacing.panel-gutter}` (32px) separates the dual panels on `/result/[id]`; `{spacing.card-padding}` (24px); `{spacing.option-gap}` (12px) between answer options — wide enough that mis-taps are unlikely on mobile.

**Breakpoints.** None were specified upstream, so these are set here and are now the contract:

| Token | Width    | Behavior                                                                                     |
| ----- | -------- | -------------------------------------------------------------------------------------------- |
| `sm`  | < 640px  | Single column. Result page → tabs. History → slide-out sheet.                                |
| `md`  | ≥ 768px  | Landing form and history stack vertically, both full-width.                                  |
| `lg`  | ≥ 1024px | Dual-panel result (58% results / 42% chat). Landing two-pane. History as persistent sidebar. |

The **`lg` (1024px) boundary is the one that matters** — it is where the dual panel collapses to tabs and where the sidebar becomes a sheet. `/quiz/[id]` is single-column at every width; a question card never needs more than the reading measure, so there is nothing to collapse.

Mobile is a first-class surface, not a degraded one. Per PRD OQ-2: **no "best on desktop" notice**, ever.

## Elevation & Depth

Inherited from shadcn, used sparingly. Depth in this system comes from **tonal layering** (sunken → base → raised), not from shadow stacking. Shadows appear in exactly three places: the mobile history sheet, dropdown/select popovers, and the sticky chat panel's top edge when content scrolls beneath it. Cards and answer options carry **no resting shadow** — a page of shadowed cards reads busy, and busy is the opposite of this brand.

## Shapes

Softer than shadcn's defaults: `{rounded.sm}` 6px for inputs and chips-with-corners, `{rounded.md}` 10px for buttons, cards, and answer options, `{rounded.lg}` 14px for dialogs, sheets, and chat bubbles. `{rounded.full}` is reserved for strength chips and the progress indicator.

The softness is doing brand work. Tighter corners read "tool, be efficient"; these read "sit down, take your time." That is the correct instruction for this product.

## Components

Brand-layer components — everything else inherits shadcn unchanged:

- **Answer option** — the most-touched element in the product. `{colors.surface-raised}` fill, 1px `{colors.surface-sunken}` border, `{rounded.md}`, 16px padding, **48px minimum height** (exceeds the 24px AA target floor with room for comfortable thumb use). Selected state swaps to `{colors.surface-sunken}` fill with a **2px `{colors.primary}` border** — note the border _thickens_, so selection is conveyed by weight as well as color, never by color alone.
- **Strength chip** — `{rounded.full}`, solid strength-scale fill, white text, 4px/12px padding. **Always carries its label** (`strong` / `mixed` / `weak`) as text. The color is reinforcement; the word is the message.
- **Score display** — `{typography.score}` in `{colors.ink}`, not in a strength color. The number is neutral by design; the _categories_ carry the diagnosis.
- **Button (primary)** — `{colors.primary}` fill, `{rounded.md}`, 44px min height. Other shadcn variants inherit.
- **Chat message (user)** — `{colors.surface-sunken}` fill, `{rounded.lg}`, right-aligned, capped at 80% of column width.
- **Chat message (assistant)** — transparent, full width, `{typography.reading}`. The assistant speaks _on the page_ rather than from a bubble; it reads as the document talking back, not as a chatbot.
- **Focus ring** — 2px `{colors.accent}`, 2px offset, on every interactive element. Non-negotiable, and the accent's primary job.

## Do's and Don'ts

| Do                                                            | Don't                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| Inherit shadcn for everything outside the brand layer         | Override shadcn tokens beyond those listed in frontmatter |
| Render `weak` in clay `#A8574B`                               | Substitute red — weak is information, not an error        |
| Pair every strength color with its text label                 | Let color be the sole carrier of any meaning              |
| Use `{colors.accent}` for focus rings and the one primary CTA | Use accent decoratively, or as a second brand color       |
| Convey selection with border weight _and_ color               | Convey selection with color alone                         |
| Cap prose at `{spacing.reading-measure}`                      | Let chat or explanations run full-bleed on wide screens   |
| Keep surfaces warm (`#FAF8F5` / `#1A1815`)                    | Use pure grey or pure black — both read clinical          |
| Layer tonally (sunken → base → raised)                        | Stack shadows to create hierarchy                         |
| Minimum 14px type, 44px touch targets                         | Ship 12px metadata or 32px tap areas                      |
| Import motion from `motion/react`                             | Import from `framer-motion` (renamed Nov 2024)            |
