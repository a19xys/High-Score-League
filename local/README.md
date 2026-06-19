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
- `pack.example.json`: example metadata for a downloadable game/week pack.
- `examples/`: extra local development manifests, including the flat
  `hsl-invaders` pack example used to test `Abrir pack`.

## Modelo de distribución

The `local/` folder in this repository is development source, not the installed
player app and not a weekly pack. The intended product model is:

```text
High Score League Launcher installed once
+
external game/week packs
+
shared persistent userData
```

### App instalada

The installed app is the program the player installs once. Conceptually, it is
the High Score League Launcher.

It owns login/account linking, local session, the global pending/sent/failed
queue, logs, preferences, diagnostics, opening/importing packs, launching MAME
from the active pack, and submitting scores to the web endpoint.

The installed app must survive deleting any downloaded pack. Its persistent
data lives in shared user data:

- Windows: `%APPDATA%/High Score League/`, or `%LOCALAPPDATA%/High Score League/`
  when `%APPDATA%` is unavailable.
- GNU/Linux: `$XDG_DATA_HOME/high-score-league/`, or
  `~/.local/share/high-score-league/` when `$XDG_DATA_HOME` is unavailable.
- macOS future/default support:
  `~/Library/Application Support/High Score League/`.

Target persistent layout:

```text
session.json
account.json
events/
  pending/
  sent/
  failed/
logs/
preferences.json
packs/
  recent.json
```

The current MVP prepares these paths but does not create or migrate them
automatically.

### Pack externo por juego/semana

Each player downloads one ZIP per game/week and can extract it anywhere:
Downloads, Desktop, an external disk, or a games folder.

Example pack:

```text
HSL_SpaceInvaders_Semana12/
  pack.json
  mame/
    mame.exe
    roms/
      invaders.zip
    plugins/
      hsl-score/
        init.lua
        plugin.json
        core/
        games/
        config.lua
```

The pack brings MAME, the ROM, the `hsl-score` plugin, and pack metadata. It is
disposable: deleting it must not delete the player's session, linked account,
pending submissions, logs, or preferences.

In a future launcher flow, the installed app will open/import a pack folder,
read its `pack.json`, resolve MAME paths relative to that pack folder, and
launch that pack's MAME.

## Pack descargable

`pack.json` describes an external game/week pack, not the installed app. See
`pack.example.json` for the versioned example. It includes pack identity, game
ID, ROM name, week ID, web URL, MAME paths relative to the pack root, and plugin
metadata. It must not contain secrets, ROM files, or personal machine paths.

The current CLI still supports a development fallback that looks for
`pack.json` next to the local development app shape. The product direction is
external pack folders opened by the installed launcher; helper code already
supports reading a pack from an arbitrary directory, but there is no pack picker
or GUI yet.

## Versioned and local files

Versioned files include source code, examples, tests, documentation, and
`.gitkeep` files for queue folders.

Local files are intentionally ignored by Git:

- `local/hsl-local-app/config.json`
- `local/pack.json`
- `local/hsl-local-app/pack.json`
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
or let them resolve to shared user data. In the installed-app model,
`config.json` is global app configuration or development override, not pack
metadata:

```json
{
  "userDataDir": "auto",
  "eventsBaseDir": "userData/events",
  "sessionFile": "userData/session.json",
  "supabaseUrl": "https://TU_PROYECTO.supabase.co",
  "supabaseAnonKey": "TU_SUPABASE_ANON_KEY",
  "clientVersion": "0.1.0",
  "defaultComment": "Subida desde app local"
}
```

Set `supabaseUrl` and `supabaseAnonKey` for your environment. Use the Supabase
anon key, never a `service_role` key.

Fields such as `defaultWeekId`, `webBaseUrl`, and MAME paths belong to
`pack.json` in the external-pack model. They may still appear in `config.json`
for legacy development compatibility.

## Modo desarrollo: app desde repo + pack externo

This is a temporary development bridge until there is a real installed Launcher
or a pack selector. It keeps source code in the repository, runs the local app
from `local/hsl-local-app`, and points that app at a real external MAME test
pack extracted somewhere else.

Example layout:

```text
C:/Users/u/Documents/High Score League/
  local/
    hsl-local-app/
    mame-plugin/
      hsl-score/

C:/Users/u/Downloads/hsl-invaders/
  mame.exe
  roms/
    invaders.zip
  plugins/
    hsl-score/
      init.lua
      plugin.json
      core/
      games/
      config.lua
      events/
        pending/
        sent/
        failed/
```

In this mode:

- the app is still executed from `local/hsl-local-app`;
- the test pack can live in any folder outside the repository;
- the `hsl-score` plugin is copied from the repo into the pack's MAME
  `plugins/hsl-score` folder;
- the ignored local `config.json` can point MAME and event paths at the
  external pack;
- `sessionFile` can stay in `userData/session.json`, so local login/session data
  is not tied to the disposable pack;
- events may temporarily live in the external pack's plugin folders while the
  launcher does not yet rewrite plugin output paths to shared user data.

Use `config.dev-bridge.example.json` as the versioned template for this setup.
Copy it to the ignored `config.dev-bridge.json` or adapt its values into the
ignored `config.json`. The example uses placeholders only and is for local
development, not final distribution.

This bridge is valid for local testing, but it is not the final product model.
The final Launcher should keep persistent data in shared userData and read
MAME/game metadata from external pack `pack.json` files.

## Sincronizar plugin al pack de prueba

For the current dev bridge only, the local app includes a small helper that
copies the versioned `hsl-score` plugin from this repository into the external
MAME pack configured in the ignored local `config.json`.

Preview the copy first:

```powershell
node app.js sync-plugin --dry-run
```

Then sync it:

```powershell
node app.js sync-plugin
```

The source is resolved from the local app directory:

```text
local/mame-plugin/hsl-score/
```

The destination is derived from the effective MAME config:

```text
<mame.workingDir>/plugins/<mame.pluginName>/
```

The helper copies only plugin source files:

```text
init.lua
plugin.json
config.example.lua
core/**
games/**
```

It does not copy ROMs, MAME binaries, real events, sessions, userData, or
`config.lua`. It also does not delete unknown files from the pack. Existing pack
events and the pack-local `config.lua` are preserved.

This command is temporary development tooling. It does not replace the final
multi-pack launcher flow. When the installed app can open/import external packs,
this helper should be reviewed or replaced by pack verification and plugin
configuration steps owned by the launcher.

## Flujo minimo probado

The current MVP has been validated end to end in dev bridge mode with Space
Invaders. This is a technical development flow, not the final player
experience. The future GUI should reduce it to opening a pack, playing or
practicing, and uploading scores.

From `local/hsl-local-app`:

```powershell
node app.js diagnose
node app.js sync-plugin --dry-run
node app.js sync-plugin
node app.js play invaders
node app.js scan pending
node app.js show <archivo.json>
node app.js auth-status
node app.js login <email>
node app.js submit <archivo.json>
node app.js scan sent
node app.js practice invaders
node app.js scan pending
```

Expected flow:

- `diagnose` confirms config, dev bridge, MAME, plugin, event folders, launcher
  args, and local session status without changing files.
- `sync-plugin --dry-run` previews plugin files copied from the repo to the
  external pack; `sync-plugin` performs the copy.
- `play invaders` launches competition mode and explicitly activates
  `hsl-score`.
- Manual capture from the MAME plugin writes a JSON event into `pending`.
- `scan pending` and `show <archivo.json>` verify the event before upload.
- `auth-status` and `login <email>` manage the local Supabase session in
  userData.
- `submit <archivo.json>` uploads one pending event and moves success to `sent`;
  `submit-all` can upload the whole pending queue.
- `practice invaders` does not pass `-plugin hsl-score`; if the plugin is
  enabled globally in `plugin.ini`, MAME may still load it.

For now, events can live temporarily in the external pack's plugin folder. In
the installed launcher model, persistent queues should live in shared userData
instead.

## Estado estable del MVP local

This CLI MVP is stable enough to close the local end-to-end phase for Space
Invaders in dev bridge mode.

What already works:

- `diagnose` audits config, dev bridge paths, MAME, plugin, launcher args,
  queues, and session status without running MAME or uploading data.
- `sync-plugin` copies the versioned `hsl-score` plugin to the configured test
  pack without copying ROMs, MAME, events, sessions, userData, or `config.lua`.
- `play invaders` launches competition mode with `-plugins -plugin hsl-score`.
- Manual capture from the MAME plugin writes a pending JSON event.
- `scan pending` and `show <archivo.json>` review local events before upload.
- `login`, `auth-status`, and `logout` manage the Supabase session in userData.
- `submit <archivo.json>` and `submit-all` upload pending events to the web
  ingest endpoint.
- Accepted submissions, including accepted duplicates, move to `sent`.
- Controlled validation/server failures move to `failed` with a failure note.
- Network/auth/retryable failures leave events in `pending`.
- `practice invaders` does not pass `-plugin hsl-score` explicitly.
- `diagnose` warns if `plugin.ini` appears to activate `hsl-score` globally.

What this is not yet:

- no GUI;
- no installed launcher;
- no pack selector;
- no complete multi-pack flow;
- no final distributable ZIP or installer;
- no F12 capture;
- no automatic Game Over capture;
- no auto-submit;
- no DIP enforcement;
- no strong anti-cheat;
- no save/load/rewind blocking.

Stability criteria:

- pending events are not deleted on network or auth errors;
- tokens and Supabase keys are not printed by diagnose or normal status output;
- plugin sync does not touch ROMs, MAME, events, sessions, userData, or pack
  `config.lua`;
- queue moves never overwrite an existing destination file; colliding names get
  a suffix such as `__2`;
- `submit-all` skips files modified less than 2000ms ago to avoid reading JSON
  while MAME/plugin code may still be writing it;
- `submit <archivo.json>` warns for a very recent file, and if that recent file
  is invalid JSON it stays in `pending` instead of moving to `failed`;
- old invalid JSON is moved to `failed` with a clear reason;
- events move to `sent` only after an accepted upload or accepted duplicate;
- `practice` does not explicitly activate the score plugin.

## GUI minima del launcher

The launcher GUI wraps the validated CLI behavior instead of reinventing it.
The current prototype is an Electron development app that shows local session
status, the effective dev bridge or pack config, the active Space Invaders
week, pending/sent/failed counts, a pending list, actions, and command output.
The polished first screen is centered on the player flow: active game, ready
state, `Jugar competición`, practice, pending uploads, friendly messages, and a
secondary development tools area for diagnostics and plugin sync. It can also
open an external pack folder for the current GUI session without modifying the
local `config.json`.

Design document: [`docs/launcher-gui-0.md`](docs/launcher-gui-0.md).
Prototype notes: [`docs/launcher-gui-1.md`](docs/launcher-gui-1.md).
Pack opening notes:
[`docs/launcher-pack-open-1.md`](docs/launcher-pack-open-1.md).

Run it from the repository root:

```powershell
npm.cmd --prefix local/hsl-local-app run gui
```

Or from `local/hsl-local-app`:

```powershell
npm run gui
```

The GUI uses the same effective local config as the CLI. It can run
`diagnose`, competition `play`, `practice`, `submit-all`, local `logout`, and
development-only `sync-plugin`. Login remains a CLI action for now:

```powershell
npm.cmd --prefix local/hsl-local-app run login -- <email>
```

To test the product-style flow, press `Abrir pack` in the launcher and select
the root folder that contains `pack.json`. When the pack is valid, the GUI uses
that pack's MAME paths, ROM, week, web URL, and plugin-local event queue for
the current session. This is in-memory only for now: it does not create recent
packs, does not persist selection, and changing packs does not delete pending
events.

For the current flat development pack at
`C:/Users/u/Downloads/hsl-invaders/`, create the temporary manifest manually by
copying:

```text
local/examples/pack.hsl-invaders-flat.example.json
```

to:

```text
C:/Users/u/Downloads/hsl-invaders/pack.json
```

Then edit `weekId`. In this flat layout, MAME is resolved from the pack root:

```json
"mame": {
  "relativeExecutablePath": "mame.exe",
  "workingDir": ".",
  "pluginName": "hsl-score"
}
```

This is only for the current development pack. The cleaner final pack layout
continues to be the one documented by `local/pack.example.json`, with MAME
inside a `mame/` subfolder.

Architecture constraints for that GUI:

- do not store session/account data inside a disposable pack;
- do not assume packs live in `Downloads`;
- do not delete pending submissions when a pack is deleted;
- keep persistent data in shared userData;
- treat `sync-plugin` as temporary development tooling, not as an end-user
  feature.

This prototype is not packaged, not an installer, and not the final pack picker.
Pack opening is the first incremental step toward the final pack flow, not
complete multi-pack management.

Configuration precedence is:

1. Explicit `config.json`, when present.
2. `pack.json`, when present.
3. Safe defaults using shared `userData`.

Event paths resolve as follows:

1. If `eventsPendingDir`, `eventsSentDir`, and `eventsFailedDir` are explicitly
   configured, those paths are used.
2. Otherwise `eventsBaseDir` is used and `pending`, `sent`, and `failed` are
   derived below it.
3. Otherwise the app uses `userData/events`.

`sessionFile` can also point at user data:

```json
{
  "sessionFile": "userData/session.json"
}
```

Legacy relative session paths such as `.hsl-session.json` still resolve relative
to `hsl-local-app` for compatibility.

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
It also prints the effective config source, `pack.json` status, resolved
`userDataDir`, final event paths, and final session file. A missing active pack
is not fatal by itself in the installed-app model.

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

The current CLI launcher reads the effective development config. The product
launcher will receive an external pack path, read that pack's `pack.json`,
resolve `mame.relativeExecutablePath` relative to the pack, and launch MAME from
the pack. Uploads still require `submit` or `submit-all`. Future phases can add
pack opening, GUI, F12 capture, automatic Game Over capture, official DIP
enforcement, and explicit save/load/rewind handling.

## MAME plugin setup

The repo copy lives at:

```text
local/mame-plugin/hsl-score/
```

For a playable external pack, the plugin lives inside that pack's MAME folder:

```text
<PACK_ROOT>/mame/plugins/hsl-score/
```

Copy `config.example.lua` to `config.lua` inside that plugin folder if you need
local overrides. The default output path is `events/pending` relative to the
plugin folder. In the target architecture, competition events should end up in
shared user data:

```text
userData/events/pending
userData/events/sent
userData/events/failed
```

Future `play` should prepare or update the plugin config in the active pack so
the plugin writes to `userData/events/pending`. `practice` should not activate
`hsl-score` explicitly. This task does not implement that plugin-config rewrite
yet.

In the current MVP, the app and plugin only communicate through local JSON
files:

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
