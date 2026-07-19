# InkFlow (墨影) — Design System

## Color Strategy: Restrained (Tinted Neutrals + One Accent)

All colors use OKLCH. Warm-tinted neutrals (hue 60) with a single accent hue (35-45).

### Light Theme
| Role | OKLCH | Usage |
|------|-------|-------|
| `theme-bg` | `oklch(0.98 0.005 60)` | Page background |
| `theme-sidebar` | `oklch(0.99 0.003 60)` | Sidebar, cards |
| `theme-border` | `oklch(0.93 0.005 60)` | Borders, dividers |
| `theme-text` | `oklch(0.20 0.010 60)` | Primary text |
| `theme-muted` | `oklch(0.55 0.010 60)` | Secondary text |
| `theme-accent` | `oklch(0.40 0.12 35)` | Primary accent (deep red-brown) |

### Dark Theme
| Role | OKLCH | Usage |
|------|-------|-------|
| `theme-bg` | `oklch(0.14 0.008 60)` | Page background |
| `theme-sidebar` | `oklch(0.17 0.008 60)` | Sidebar, cards |
| `theme-border` | `oklch(0.24 0.008 60)` | Borders, dividers |
| `theme-text` | `oklch(0.88 0.005 60)` | Primary text |
| `theme-muted` | `oklch(0.52 0.005 60)` | Secondary text |
| `theme-accent` | `oklch(0.78 0.08 45)` | Primary accent (lighter warm) |

### Rules
- Never use pure `#000` or `#fff` — all neutrals are warm-tinted
- Chroma reduces as lightness approaches 0 or 100
- Accent is used sparingly (≤10% of surface area)

## Typography

| Token | Font | Usage |
|-------|------|-------|
| `font-sans` | Inter, system-ui | UI labels, controls |
| `font-serif` | Merriweather | Writing surface, content |
| `font-mono` | JetBrains Mono | Counters, code, data |

### Hierarchy
- Body: `text-sm` (14px), `leading-6` (24px)
- Writing surface: `text-[1.18rem]` (18.88px), `leading-[1.95]`
- Headings: `font-bold` with `text-lg` to `text-3xl`
- Line length cap: 65-75ch for body text

### Rules
- Weight contrast ≥1.25 ratio between hierarchy steps
- Tabular numbers (`tabular-nums`) for all numeric counters
- Letter spacing: `-0.015em` for body, `-0.01em` for mono

## Layout & Spacing

### Grid System
- Sidebar: Fixed `76px` collapsed, `~200px` expanded
- Main content: Fluid with `max-w-6xl` constraint
- Editor: 3-panel layout (chapter sidebar | writing surface | agent workspace)

### Spacing Rhythm
- Page padding: `p-8` (32px)
- Card padding: `p-5` (20px)
- Section gaps: `gap-4` to `gap-8`
- Inline spacing: `gap-2` to `gap-3`

### Cards
- `rounded-md` (6px) for control cards
- `rounded-2xl` (16px) for content cards
- Hairline border: `1px solid color-mix(in oklch, border 40%, transparent)`
- Hover: Border opacity increases to 70%, subtle shadow `0 1px 3px`

## Motion

### Curves
- Primary: `cubic-bezier(0.16, 1, 0.3, 1)` (exponential ease-out)
- Duration: `150ms` for micro-interactions, `200ms` for transitions

### Rules
- **Never animate CSS layout properties** (width, height, padding)
- **No bounce, no elastic** — all easing is exponential out
- Respect `prefers-reduced-motion: reduce` (global CSS override)
- Active states use opacity change (`opacity-85`/`opacity-95`), not scale

## Component Patterns

### Buttons
- Primary: `px-3.5 py-1.5`, `text-xs font-semibold`, accent background
- Ghost: Transparent with hover background
- No `active:scale-95` — use opacity for press feedback

### Modals/Drawers
- Focus trap with Tab key interception
- Escape key to close
- Backdrop: `bg-black/10 backdrop-blur-[2px]`
- Auto-focus first interactive element on open

### Scrollbars
- Ultra-thin: `6px` width
- Track: Transparent
- Thumb: `10%` opacity of theme-text, `25%` on hover
- Dark theme: `15%` base, `30%` on hover

## Absolute Bans (from Impeccable)
- Side-stripe borders (>1px border-left/right as accent)
- Gradient text (background-clip: text)
- Glassmorphism as default
- Hero-metric template
- Identical card grids
- Modal as first thought

## Anti-Patterns to Avoid
- Bouncy animations (scale transforms on press)
- Heavy drop shadows (use subtle 1-2px shadows)
- Pure black/white colors
- Overuse of accent color (>10% surface area)
- Long scrolling settings pages (use tabs)

## Accessibility
- Radix UI primitives for ARIA defaults (AlertDialog, Tabs, Tooltip, ScrollArea)
- `role="dialog"` and `aria-modal` on all modals
- `aria-label` on interactive elements
- Keyboard navigation with focus management
- `prefers-reduced-motion` support
