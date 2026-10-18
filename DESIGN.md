# Sentinel AI — Design System (`DESIGN.md`)

Sentinel AI is a beneficial-ownership and perpetual-KYC application for bank compliance analysts. This specification defines the visual identity, tokens, typography, layout shell, hand-built SVG graph rendering, and animation catalogue.

---

## 1. Brand Assets
- Topbar logo: `/brand/sentinel-mark-64.png` (displayed at 30px height, no tile behind it)
- Sign-in screen (Phase 2): `/brand/sentinel-mark-192.png`
- Favicon: Default favicon left unchanged for Phase 1.
- **Strict Brand Rule**: These are the Sentinel shield logo. Never redraw, recolour, distort, or modify them, and never place a white wordmark on a light surface.

---

## 2. Design Tokens & Colour Discipline

### Light Theme Only
- Sentinel AI uses the light DESIGN.md palette everywhere. Never introduce dark mode or `prefers-color-scheme: dark` overrides.
- All modals, dialogs, cards, toasts, and surfaces render with `--card` (`#ffffff`), `--bg2` (`#fbfaf8`), or `--bg` (`#f6f4f1`), with `--ink` typography and 1px `--line` borders.
- All text and interactive states must satisfy WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI controls).

### Colour Discipline
- **Neutral by default**: Surfaces, backgrounds, text, borders, icons, and chips use neutral ink and grey tokens.
- **Primary blue for interaction only**: Links, primary buttons, selected tabs/cards, active states, and focus rings. Never used as decorative background fills.
- **Semantic colour carries meaning only**:
  - **Rose (`--rose`)**: Official sanctions hits, dissolved entities, and HIGH risk tier.
  - **Amber (`--amber`)**: Review queues, PEP exposures, ELEVATED risk tier, and regulatory warnings.
  - **Emerald (`--emerald`)**: Cleared entities and DEFINITE UBO determinations.
  - **Grey (`--grey`)**: STANDARD risk tier, data gaps, and unknown holders. STANDARD risk is neutral grey, never green.
- **Status Badges**: Always rendered as a small subtle badge: a 6px coloured dot plus text in `--ink2` on a neutral `--bg2` pill with a 1px `--line` border. Never use solid saturated fills for badges.
- **Icon Tiles**: Always neutral: a 40px or 44px `--bg2` tile with 1px `--line` border and a monochrome `--ink2` outline icon. No per-item accent color tiles or decorative backgrounds.
- **Chips**: Neutral outline chips (`1px solid var(--line)`, text `--ink2`) by default.

### Backgrounds
- `--bg`: `#f6f4f1`
- `--bg2`: `#fbfaf8`
- `--card`: `#ffffff`

### Ink (Typography & Foregrounds)
- `--ink`: `#221e33`
- `--ink2`: `#5c5870`
- `--ink3`: `#9995a8`

### Lines & Borders
- `--line`: `#e9e5de`
- `--line2`: `#f1eee8`

### Primary Blue (from Sentinel Logo)
- `--primary`: `#016EFD`
- `--primary2`: `#5AA9FE`
- `--primary-s`: `#E8F2FF`
- `--cyan`: `#00C8FC`
- `--deep`: `#021AF1`

### Semantic Accents
- **Coral (Accent / Alerts)**: `--coral`: `#f4553f`, `--coral-s`: `#feefec`
- **Emerald (Clear / Definite UBO)**: `--emerald`: `#059669`, `--emerald-s`: `#e6f6ef`
- **Amber (Review / PEP / Possible UBO / Warning)**: `--amber`: `#d97706`, `--amber-s`: `#fdf3e5`
- **Rose (Hit / Sanctions / Dissolved)**: `--rose`: `#e11d48`, `--rose-s`: `#fdecf0`
- **Grey (Unknown / Below Threshold / Data Gap)**: `--grey`: `#8b8798`, `--grey-s`: `#f0efec`

### Motion & Elevation
- **Standard Transition**: `--ts`: `all .22s cubic-bezier(.4,0,.2,1)`
- **Shadows**:
  - `--sh1`: `0 1px 2px rgba(34,30,51,.05), 0 1px 3px rgba(34,30,51,.05)`
  - `--sh2`: `0 4px 16px rgba(34,30,51,.08), 0 2px 5px rgba(34,30,51,.04)`
  - `--sh3`: `0 14px 44px rgba(34,30,51,.14), 0 4px 12px rgba(34,30,51,.06)`

### Signature Gradient & Headline Style
- `linear-gradient(135deg, #0284C7 0%, #016EFD 50%, #021AF1 100%)` at weight 800 reserved for two places only: the Sign-In screen and the KYC Initiation hero title. A soft decorative cyan glow (`#00C8FC`, blurred, low-opacity) is placed behind the headline, never applied to the text itself.
- All other page headings use solid `--ink`, Sora 22px to 24px, weight 700.

---

## 3. Typography & Numbers
- **Page Titles**: Sora 22px to 24px, weight 700, solid `--ink`.
- **Numbers & Figures**: All numbers use tabular figures (`font-variant-numeric: tabular-nums`). Percentages, share counts, and entity/customer IDs in JetBrains Mono.
- **Entity Names**: Never truncate entity names where they are primary identifiers; wrap to at most two lines instead.
- **Body and UI**: `Inter`, with system fallbacks (`-apple-system, BlinkMacSystemFont, sans-serif`).
- **Section labels**: `10px` to `11px`, weight 700, uppercase, letter-spacing `.6px`, colour `--ink3`.
- **Figures, IDs, percentages, timestamps, maths**: `JetBrains Mono`, monospace.
- **Section labels**: `10px` to `11px`, weight `700`, uppercase, letter-spacing `.6px`, colour `--ink3`.

---

## 4. App Shell (Fixed Layout, Body Does Not Scroll)
- **Topbar**: Fixed, `56px` tall, `--card` (`#ffffff`), bottom border `--line`.
  - **Left**: Sentinel shield logo image (`/brand/sentinel-mark-64.png`) displayed at `30px` with no tile behind it, followed by `"Sentinel"` in `--ink` + `" AI"` in `--primary`, `Sora` `16.5px` weight `800`, with a small uppercase sub-label reading `"OWNERSHIP · PERPETUAL KYC"`.
  - **Right**:
    - Mode pill (`--bg2` background, `20px` radius, small coloured dot, text `"Preview · simulated feeds"` or `"Production"`).
    - Governance toggle (segmented pill, options `"Human-in-the-loop"` and `"Automated"`, active option filled `--primary` with white text and a primary blue shadow; disabled in Phase 1 with tooltip `"Available after sign-in"`).
    - Circular avatar with the signature gradient showing initials.
- **Flow Strip**: Fixed under topbar, `44px` tall, background `--bg2`, bottom border `--line`, centred row of seven step chips separated by small chevrons.
  - Each chip has a `17px` numbered circle and a label.
  - States: `idle` (`--ink3`), `active` (`--primary` text, `--primary-s` background, `--primary` filled circle), `done` (`--emerald` text, `--emerald` filled circle).
  - Steps: `1 KYC Initiation`, `2 Autonomous Mapping`, `3 Ownership Tree`, `4 Live Monitoring`, `5 Materiality`, `6 KYC Agents`, `7 Unified Results`.
- **Icon Rail**: Fixed left, `62px` wide, `--card` (`#ffffff`), right border `--line`.
  - `44px` square items with `12px` radius.
  - Hover: `--bg2` background.
  - Active: `--primary-s` background, `--primary` icon, and a `3px` `--primary` bar on the rail's left edge.
  - Hover tooltip: dark `--ink` pill to the right. Optional `--coral` count badge top-right.
  - Rail items (top to bottom): `KYC Initiation`, `Beneficial Ownership`, `Alerts`, `Cases`. Unbuilt phases appear disabled with tooltip `"Coming soon"`.
- **Main Area**: Everything right of the rail and below the strip. Switching views animates in (`vin`).

---

## 5. Views
- **Ownership Structures** (under `Beneficial Ownership` rail item):
  - Page heading in `Sora` `22px` weight `800`, description below, then a responsive grid of cards (`minmax(330px, 1fr)`).
  - Card: white (`--card`), `16px` radius, `--sh1`, `19px` padding.
  - Top row: `44px` coloured icon tile, entity name, meta line. Status pill top-right.
  - Chip row: small `14px`-radius chips in primary blue, emerald, amber, rose, or grey soft variants.
  - Hover: lift `3px`, `--sh2`, `--primary2` border.
- **Entity Workspace**:
  - Header row (white, bottom border `--line`): `33px` back button, `42px` icon tile, entity name in `Sora` `16px`, meta line containing a mono ID chip on `--primary-s`, visible `"Synthetic data"` label, and a risk pill on the right.
  - Body: graph column plus a `318px` right side panel.
  - Graph toolbar above canvas: background `--bg2`, legend of small coloured swatches with labels, and on the right a completeness indicator: label, an `86px × 6px` track with a signature-gradient fill whose width animates over `1s`, and a mono `--primary` percentage.
  - Canvas background: radial gradient from `#fdfcfa` near the upper-left to `--bg`. Cursor `grab`, `grabbing` while dragging.
  - Side panel: tabs across the top (`UBOs`, `Screening`, `Audit`) each with a mono count badge; active tab `--primary` with a `2px` `--primary` underline. Scrollable body with `13px` padding.

---

## 6. Ownership Graph Rendering (Hand-Built SVG)
- **Layout**: Natural persons and unknown owners in the top tier, the root entity in the bottom tier, every other entity placed in tiers by longest path from the root. Order nodes within each tier to minimise edge crossings. Seed data may override a node's position.
- **Entity Nodes**: Rounded rectangles, radius `12`.
  - **Root**: `192 × 62`, filled `--primary`, white text, subtitle `"ROOT · <jurisdiction>"` in `#cfe3ff`.
  - **Standard Entity**: `154 × 52`, white fill, stroke `#c4d0e2` at `1.6px`, soft drop shadow. Country flag emoji at left, name across one or two lines (`Inter` `600`, `11px` to `12px`), jurisdiction subtitle in `9px` `--ink3`.
  - **Data-Gap Entity**: Dashed grey stroke (`6 4`), fill `#f5f4f1`, plus an outer amber dotted ring (`2 5`) that pulses (`warnp`).
  - **Dissolved Entity**: Rose strikethrough line across the node, node opacity `.55`, subtitle `"DISSOLVED"`.
- **Person Nodes**: Circles of radius `26` showing initials, with `"flag + name"` beneath and a status line beneath that.
  - **Default**: `--primary2` stroke, `#e8f2ff` fill.
  - **DEFINITE UBO**: `--emerald` stroke and fill plus a dashed outer ring of radius `32` (`3 4`).
  - **POSSIBLE UBO**: `--amber` stroke with a dashed amber ring.
  - **PEP**: `--amber` stroke.
  - **Unknown Owner**: `--grey` dashed stroke.
  - **Sanctions Hit**: `--rose` stroke and fill, `--rose` ring, status line in `--rose`.
- **Edges**: Vertical S-shaped cubic Bézier curves between points on each node's perimeter, with arrowheads.
  - Stroke width scales with ownership (`1.3 + 2 * share`, using midpoint for bands, where share is `0..1`).
  - Person-owned edges: `--emerald`.
  - Entity-owned edges: `#8fb0e3`.
  - Unknown-owner edges: dashed `--grey`.
  - Historical / dissolved edges: dashed light `#c9c2d2` at low opacity.
  - Recently changed ("hot") edges: `--amber` at `3.2px` with an `--amber` arrowhead.
- **Edge Labels**: White pill with a thin border at the curve's midpoint, mono `10px` text (`"38%"` for exact values, `"25–50%"` for bands).
- **Flowing Dots**: A small dot travels continuously along every active ownership edge (`SVG animateMotion`), each edge with a slightly different duration between `3.5s` and `6.5s`; `--emerald` on person-owned edges, soft blue on entity edges, `--amber` on hot edges.
- **Viewport Controls**: Pan by dragging the background, zoom with the mouse wheel between `0.4x` and `2.6x` centred on the cursor, fit-to-view on load (maximum scale `1.15`, with padding).

---

## 7. Animation Catalogue
All animations respect `@media (prefers-reduced-motion: reduce)`.
- `vin`: Views enter from `opacity: 0` and `translateY(8px)`, `.35s ease`.
- `Graph build`: Edges draw on via `stroke-dashoffset` over `.8s`, staggered by `.5s` plus `.09s` per edge. Edge labels fade in `.45s` after their edge. Nodes pop in with `nodein` (`.55s cubic-bezier(.34,1.4,.64,1)`, from `opacity: 0`, `translateY(14px)`, `scale(.92)`), staggered by vertical position so the top tier appears first.
- `warnp`: Data-gap rings pulse opacity between `.85` and `.25` over `2.2s`, infinitely.
- `rip`: Expanding ring on a node, radius `16` to `64`, fading out over `1s`, coloured by severity.
- `Path highlight`: Selecting a UBO dims every node not on its paths to `opacity: .16` and every other edge to `.08` over `.3s`; on-path nodes gain a primary blue glow. Clicking the background clears it.
- `slin`: UBO cards and audit items slide in from `translateX(12px)`, `.4s`.
- `drop`: Monitoring banner drops from top centre, `.5s cubic-bezier(.34,1.56,.64,1)`, with an icon whose ring pulses outward (`mpulse`: `scale(1)` to `scale(1.55)`, fading, `1.8s` infinite).
- `pop`: Overlay cards and modals enter from `scale(.94)` and `translateY(14px)`, `.4s cubic-bezier(.34,1.56,.64,1)`, over a blurred backdrop that fades in (`fade` `.3s`).
- `Orb`: Two counter-rotating rings (`--primary` over `.9s`, `--cyan` over `1.3s` reversed) around a signature-gradient core. Turns `--emerald` when complete.
- `stamp`: Verdict stamp slams in from `rotate(14deg) scale(1.7)` to `rotate(3deg) scale(1)`, `.5s cubic-bezier(.34,1.8,.64,1)`, delayed `.18s`.
- `Step lists`: Pending steps at `opacity: .32` with a grey tick circle; active steps full opacity with a `--primary` tick; completed steps with an `--emerald` tick.
- `Drawer`: Slides in from the right, `372px` wide, `.34s cubic-bezier(.4,0,.2,1)`.
- `tin`: Toasts slide in from `translateX(30px)`, `.4s` with a slight overshoot, and fade out on dismissal.
- `Hover micro-interactions`: Cards lift `3px` with a stronger shadow (`--sh2`) on hover. Buttons lift `1px` with a coloured glow on hover.
- `spin`: Spinners rotate in `.7s`.
