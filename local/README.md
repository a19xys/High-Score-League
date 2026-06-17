# High Score League local integration

This folder contains the local pieces used by the High Score League MAME MVP.
It is separate from the main web app.

## Contents

- `hsl-local-app/`: Node.js CLI that reads local JSON events, validates them,
  manages the pending/sent/failed queues, signs in with Supabase Auth, and sends
  submissions to the web ingest endpoint.
- `mame-plugin/hsl-score/`: MAME Lua plugin that currently supports Space
  Invaders (`invaders`), reads the score from memory, tracks basic rollover, and
  writes JSON events into `events/pending`.
- `mame-plugin/hsl-score/events/`: queue folders used by the local app.

## Versioned and local files

Versioned files include source code, examples, tests, documentation, and
`.gitkeep` files for queue folders.

Local files are intentionally ignored by Git:

- `local/hsl-local-app/config.json`
- `local/hsl-local-app/.hsl-session.json`
- `local/hsl-local-app/logs/`
- `local/hsl-local-app/node_modules/`
- `local/mame-plugin/hsl-score/config.lua`
- generated JSON events under `events/pending`, `events/sent`, and
  `events/failed`
- ROMs, MAME binaries, `cfg/`, `nvram/`, `sta/`, `snap/`, and `inp/`

Do not commit tokens, sessions, real event files, ROMs, MAME binaries, save
states, screenshots, INP files, or local config files.

## Local app setup

From this repository:

```powershell
cd "C:/Users/u/Documents/High Score League/local/hsl-local-app"
npm install
copy config.example.json config.json
```

Edit `config.json` locally. Keep the event paths aligned with this repo layout
unless your playable MAME pack uses a different structure:

```json
{
  "eventsPendingDir": "../mame-plugin/hsl-score/events/pending",
  "eventsSentDir": "../mame-plugin/hsl-score/events/sent",
  "eventsFailedDir": "../mame-plugin/hsl-score/events/failed",
  "mame": {
    "executablePath": "C:/RUTA/A/MAME/mame.exe",
    "workingDir": "C:/RUTA/A/MAME",
    "pluginName": "hsl-score"
  }
}
```

Set `webBaseUrl`, `defaultWeekId`, `supabaseUrl`, and `supabaseAnonKey` for
your environment. Use the Supabase anon key, never a `service_role` key.

## Basic commands

Run these from `local/hsl-local-app`:

```powershell
node app.js scan pending
node app.js scan sent
node app.js scan failed
node app.js login <email>
node app.js auth-status
node app.js submit <archivo.json>
node app.js submit-all
node app.js logout
```

You can also run from the repository root:

```powershell
npm.cmd --prefix local/hsl-local-app run scan
npm.cmd --prefix local/hsl-local-app test
```

`scan` should report `No hay eventos.` when the queue exists but is empty.

## Diagnóstico local

Before launching MAME, run:

```powershell
node app.js diagnose
```

From the repository root:

```powershell
npm.cmd --prefix local/hsl-local-app run diagnose
```

`diagnose` checks the local event folders, MAME executable and working
directory, the configured plugin folder, launcher arguments, and the local
session file without printing access or refresh tokens. It does not run MAME,
connect to Supabase, upload submissions, create folders, or modify local files.

`play` activates `hsl-score` explicitly with `-plugins -plugin hsl-score`.
`practice` does not pass `-plugin hsl-score`, but MAME can still load the plugin
if it is enabled globally in `plugin.ini`. For clean practice sessions, keep
`hsl-score` disabled globally and let `play` enable it explicitly.

`diagnose` looks for `plugin.ini` in the MAME working directory and in
`ini/plugin.ini`. If it finds a line such as `hsl-score 1`, it warns that
practice may generate pending score events.

## Launcher CLI

The local app can launch configured MAME games without a GUI:

```powershell
node app.js play invaders
node app.js practice invaders
```

From the repository root, the npm scripts accept the ROM after `--`:

```powershell
npm.cmd --prefix local/hsl-local-app run play -- invaders
npm.cmd --prefix local/hsl-local-app run practice -- invaders
```

`play` is competition mode. It starts MAME with the configured score plugin:

```text
mame invaders -plugins -plugin hsl-score
```

That mode can generate pending JSON events through the plugin. `practice`
starts MAME without `hsl-score`, so it is intended for free play and should not
generate pending score events.

The launcher reads `config.json` but does not upload anything automatically.
Uploads still require `submit` or `submit-all`. Future phases can add F12
capture, automatic Game Over capture, official DIP enforcement, and explicit
save/load/rewind handling.

## MAME plugin setup

The repo copy lives at:

```text
local/mame-plugin/hsl-score/
```

For a playable MAME pack, copy the plugin folder into the MAME plugins folder,
for example:

```text
<MAME_ROOT>/plugins/hsl-score/
```

Copy `config.example.lua` to `config.lua` inside that plugin folder if you need
local overrides. The default output path is `events/pending` relative to the
plugin folder. In a real MAME pack, the folder layout may differ from the repo,
so adjust either the plugin `config.lua` output path or the local app
`config.json` queue paths.

The app and plugin only communicate through local JSON files:

```text
MAME plugin -> events/pending -> hsl-local-app -> web ingest endpoint
```

The local app moves successfully submitted events to `events/sent`. Controlled
validation failures move to `events/failed` with a small failure note.

## Game modules

The local app has a small game registry under `hsl-local-app/src/games/`.
For now it declares Space Invaders (`invaders`) and is used by the launcher to
resolve supported ROMs. It does not change JSON validation or the ingest
payload.

These modules are preparation for later phases. In the future they can hold
launcher metadata, competition rules, Game Over detection details, official DIP
settings, and other game-specific checks.

## Declarative game rules

Game modules can now declare future-facing rules for competition and practice
modes. These declarations are metadata only: apart from launcher ROM resolution,
they are not enforced and they do not change the current JSON contract or ingest
payload.

For `invaders`, the metadata marks F12 capture, Game Over detection, DIP rules,
launcher settings, and audit fields as planned or pending. Future phases can
use those declarations for a launcher, hotkeys, Game Over detection, official
DIPs, and save/load/rewind checks.

## Current scope

This is still an MVP. It includes a basic CLI launcher, but not a GUI, F12
hotkey, automatic Game Over capture, DIP enforcement, or strong anti-cheat.
Those should be added in later phases after the internal refactor.
