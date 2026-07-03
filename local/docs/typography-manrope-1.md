# Manrope typography direction

High Score League uses Manrope as the primary interface typeface for both the web app and the local Electron launcher.

The visual direction is:

- Arcade identity stays in logos, covers, icons and game assets.
- Interface typography stays clean, modern and readable.
- The light theme should feel calmer and more premium before any larger color rebalance.

## Web

The Next.js web app loads Manrope through `next/font/google` in `app/layout.tsx`.

Configured weights:

```text
400, 500, 600, 700, 800
```

The font is exposed through `--font-sans` and applied globally in `app/globals.css` with a `system-ui` fallback.

## Local Launcher

The Electron launcher does not load Google Fonts or any remote font URL at runtime.

Manrope is self-hosted under:

```text
local/hsl-local-app/gui/renderer/assets/fonts/manrope/
```

Included files:

```text
Manrope-Regular.woff2
Manrope-Medium.woff2
Manrope-SemiBold.woff2
Manrope-Bold.woff2
Manrope-ExtraBold.woff2
OFL-1.1.txt
```

Source package used for these assets:

```text
@fontsource/manrope 5.2.8
```

License:

```text
SIL Open Font License 1.1 (OFL-1.1)
```

The launcher declares local `@font-face` rules in `styles/app.css` and exposes the stack through `--font-sans` in `styles/tokens.css`.

## Weight Guidance

- Body copy: 400.
- Secondary important text: 500 or 600.
- Buttons and badges: 700.
- Panel titles and active labels: 700 or 800.
- Game title and primary play actions: 800.
- Metadata values: 700.
- Avoid broad use of 900/950 for UI text; reserve very heavy visual emphasis for brand or game assets when needed.
