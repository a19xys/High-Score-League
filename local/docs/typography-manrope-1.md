# Manrope typography direction

High Score League uses Manrope as the primary interface typeface for both the web app and the local Electron launcher. Sora is layered on top as the title typeface for headings and prominent title labels.

The visual direction is:

- Arcade identity stays in logos, covers, icons and game assets.
- Interface typography stays clean, modern and readable.
- The light theme should feel calmer and more premium before any larger color rebalance.
- Titles can use Sora for a sharper editorial tone; body copy, controls, badges and metadata remain Manrope for readability.

## Web

The Next.js web app loads Manrope and Sora through `next/font/google` in `app/layout.tsx`.

Configured weights:

```text
400, 500, 600, 700, 800
```

The font is exposed through `--font-sans` and applied globally in `app/globals.css` with a `system-ui` fallback.

Sora is configured with:

```text
400, 600, 700, 800
```

It is exposed through `--font-title` and applied to headings and `.theme-title`.

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

Sora is also self-hosted for title use under:

```text
local/hsl-local-app/gui/renderer/assets/fonts/sora/
```

Included files:

```text
Sora-Regular.woff2
Sora-SemiBold.woff2
Sora-Bold.woff2
Sora-ExtraBold.woff2
OFL-1.1.txt
```

Source package used for these assets:

```text
@fontsource/sora 5.2.8
```

License:

```text
SIL Open Font License 1.1 (OFL-1.1)
```

## Weight Guidance

- Body copy: 400.
- Secondary important text: 500 or 600.
- Buttons and badges: 700.
- Panel titles and active labels: Sora 700 or 800.
- Game title and primary play actions: Sora 800.
- Metadata values: 700.
- Avoid broad use of 900/950 for UI text; reserve very heavy visual emphasis for brand or game assets when needed.
