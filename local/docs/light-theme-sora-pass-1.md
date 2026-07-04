# Light theme and Sora pass 1

This pass introduces Sora as the title typeface while keeping Manrope as the primary body and UI typeface.

## Typography

- Web loads Manrope and Sora through `next/font/google` in `app/layout.tsx`.
- The local Electron launcher uses self-hosted Sora files from `local/hsl-local-app/gui/renderer/assets/fonts/sora/`.
- `--font-sans` remains Manrope.
- `--font-title` is Sora with Manrope as fallback.
- Sora is limited to headings, pack titles, game title labels, dialog titles, busy overlay copy and the library open label.
- Buttons, badges, body text, metadata and form controls remain Manrope.

## Light Color System

The light palette was rebalanced away from plain white and slate defaults toward a cooler arcade-neutral system:

- Background: `#eef4fb`
- Surface: `#fbfdff`
- Elevated surface: `#ffffff`
- Muted surface: `#e7eef7`
- Subtle surface: `#f3f7fc`
- Border: `#c8d5e4`
- Soft border: `#dce6f1`
- Text: `#10243f`
- Muted text: `#55708c`
- Circuit accent: `#0f78a8`
- Circuit strong: `#0b5f87`
- Circuit soft: `#d9eef8`

Semantic tokens for ok, warning, error and info were also tightened for better contrast on light surfaces.

## Launcher Surfaces

The launcher now has light-only overrides for:

- Main background gradient.
- Header, panels, pack cards, detail card, account menu, dialogs and busy overlay.
- Metadata grids, account surfaces, known account rows, auth forms and account notes.
- Library controls, view buttons, secondary actions, tool buttons, theme buttons, icon buttons and dialog buttons.

The overrides are scoped with `html:not([data-theme="dark"])` so the dark theme keeps its existing treatment.

## Icon View

Icon and list media stages now use `--icon-stage` and `--icon-stage-strong` in light mode. This removes the dark tile background from the Iconos view while keeping a defined stage for transparent pack art and logo assets.

## Dark Theme

Dark theme changes are limited to fallback definitions for new tokens:

- `--surface-elevated`
- `--surface-subtle`
- `--border-soft`
- `--text-soft`
- `--circuit-soft`
- `--icon-stage`
- `--icon-stage-strong`
- `--info`
- `--info-bg`

No dark layout or component treatment was intentionally redesigned.

## Font Assets

Sora assets were sourced from:

```text
@fontsource/sora 5.2.8
```

License:

```text
SIL Open Font License 1.1 (OFL-1.1)
```
