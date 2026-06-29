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
  `hsl-invaders` pack example used to test `Abrir pack`, plus optional
  `metadata.json` examples for local pack presentation and a lightweight
  `packVersion: 2` example.

## Modelo de distribución

The `local/` folder in this repository is development source, not the installed
player app and not a weekly pack. The intended product model is:

```text
High Score League Launcher installed once
+
shared MAME runtime installed once with the app
+
lightweight game/week packs
+
shared persistent userData
```

Final shared MAME runtime blueprint:
[`docs/shared-mame-runtime-blueprint-1.md`](docs/shared-mame-runtime-blueprint-1.md).
Implemented shared MAME runtime notes:
[`docs/shared-mame-runtime-1.md`](docs/shared-mame-runtime-1.md).

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

### Pack ligero por juego/semana

Final packs should be lightweight. They should not include MAME. The installed
app owns the shared MAME runtime and launches it with resources from the active
pack.

Preferred final pack layout:

```text
HSL_SpaceInvaders_Semana12/
  pack.json
  metadata.json
  manifest.json
  assets/
  manual/
  roms/
  artwork/
  samples/
  cfg/
  scripts/
```

Final pack responsibility:

- `pack.json`: technical/play/competition contract.
- `metadata.json` and `assets/`: local presentation.
- `manifest.json`: pack version and integrity.
- `roms/`, `artwork/`, `samples/`: resources consumed by shared MAME.
- `manual/`: local player documentation.
- `scripts/` or `plugins/`: capture adapter/config if the final MAME loading
  model needs it.

The final app should manage one configured pack directory, for example:

```text
D:/High Score League Packs/
  space-invaders/
  galaga/
  pac-man/
```

The current multi-location library is useful as an implementation step, but the
preferred product direction is one pack directory with actions to choose,
change, open and rescan it.

### Pack externo v1 y bridge de desarrollo deprecated

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

In this v1/dev model, the pack brings MAME, the ROM, the `hsl-score` plugin,
and pack metadata. It is disposable: deleting it must not delete the player's
session, linked account, pending submissions, logs, or preferences.

This model is legacy/deprecated. It remains supported only for the current dev
bridge and old tests until the shared MAME runtime is implemented.

In the final shared-runtime model, the installed app will read the active
pack's `pack.json`, resolve ROM/artwork/sample/config paths inside the pack,
and launch the app-managed MAME runtime.

## Pack descargable

`pack.json` describes an external game/week pack, not the installed app. See
`pack.example.json` for the versioned example. It includes pack identity, game
ID, ROM name, week ID, web URL, MAME paths relative to the pack root, and plugin
metadata. It must not contain secrets, ROM files, or personal machine paths.

`packVersion: 2` is the current lightweight pack contract. It does not declare
`mame.exe` inside the pack as the primary runtime path. It declares pack
identity, competition fields, runtime type, relative MAME resource paths and
capture mode. The v1 `mame.relativeExecutablePath` field remains temporary
compatibility for current tests, examples and the development bridge.

The app now stores the shared MAME executable path in
`userData/runtime/mame-runtime.json`. Practice for v2 packs can use that shared
runtime with pack-local resources. Competition for v2 remains blocked until the
plugin/adaptor loading task is implemented.

Pack contract notes:
[`docs/pack-contract-2.md`](docs/pack-contract-2.md).

Packs may also include optional presentation files next to `pack.json`:

```text
metadata.json
assets/
```

`metadata.json` is not authority for competition. It can provide title,
subtitle, description, credits, manual/ranking links, and local asset paths for
the launcher UI. `assets/` can hold local `hero`, `logo`, `icon`, and `cover`
images. If metadata or assets are missing or invalid, the app falls back to the
technical pack/game data and keeps the pack playable.

Metadata and assets notes:
[`docs/pack-metadata-assets-1.md`](docs/pack-metadata-assets-1.md).
Pack library locations notes:
[`docs/pack-library-locations-1.md`](docs/pack-library-locations-1.md).
Season membership check notes:
[`docs/season-membership-check-1.md`](docs/season-membership-check-1.md).
Season membership diagnostics notes:
[`docs/season-membership-check-2.md`](docs/season-membership-check-2.md).
Auto-sync queue notes:
[`docs/auto-sync-queue-1.md`](docs/auto-sync-queue-1.md).
Pack readiness notes:
[`docs/pack-readiness-1.md`](docs/pack-readiness-1.md).
Pack directory model notes:
[`docs/pack-directory-model-1.md`](docs/pack-directory-model-1.md).
Pack contract v2 notes:
[`docs/pack-contract-2.md`](docs/pack-contract-2.md).
Shared MAME runtime implementation notes:
[`docs/shared-mame-runtime-1.md`](docs/shared-mame-runtime-1.md).
MAME plugin/adapter loading v2 notes:
[`docs/mame-pack-plugin-loading-2.md`](docs/mame-pack-plugin-loading-2.md).
Pack library grid notes:
[`docs/pack-library-grid-1.md`](docs/pack-library-grid-1.md).
Account switcher notes:
[`docs/account-switcher-gui-1.md`](docs/account-switcher-gui-1.md).
Remembered sessions notes:
[`docs/account-switcher-gui-2.md`](docs/account-switcher-gui-2.md).
Account menu polish notes:
[`docs/account-menu-polish-1.md`](docs/account-menu-polish-1.md).
Launcher icon system notes:
[`docs/icon-system-1.md`](docs/icon-system-1.md).
Launcher icon visual polish notes:
[`docs/icon-visual-polish-2.md`](docs/icon-visual-polish-2.md).
Hero/logo/list preload notes:
[`docs/hero-logo-list-preload-13.md`](docs/hero-logo-list-preload-13.md).
Launcher shell layout notes:
[`docs/launcher-shell-layout-2.md`](docs/launcher-shell-layout-2.md).
Launcher shell bugfix notes:
[`docs/launcher-shell-bugfix-3.md`](docs/launcher-shell-bugfix-3.md).
Launcher visual foundation notes:
[`docs/launcher-visual-foundation-1.md`](docs/launcher-visual-foundation-1.md).
Library controls sort notes:
[`docs/library-controls-fix-sort-6.md`](docs/library-controls-fix-sort-6.md).
Library micropolish notes:
[`docs/library-micropolish-sort-scroll-7.md`](docs/library-micropolish-sort-scroll-7.md).
Render/state stability audit notes:
[`docs/render-state-stability-audit-12.md`](docs/render-state-stability-audit-12.md).

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
The final Launcher should keep persistent data in shared userData, use the
shared MAME runtime installed with the app, and read game/resource metadata
from lightweight pack `pack.json` files.

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
Final UX blueprint:
[`docs/launcher-final-ux-blueprint-1.md`](docs/launcher-final-ux-blueprint-1.md).
Pack opening notes:
[`docs/launcher-pack-open-1.md`](docs/launcher-pack-open-1.md).
Remembered-pack notes:
[`docs/launcher-pack-remember-1.md`](docs/launcher-pack-remember-1.md).
Auth GUI notes:
[`docs/launcher-auth-gui-1.md`](docs/launcher-auth-gui-1.md).
Submission recovery notes:
[`docs/launcher-submission-recovery-1.md`](docs/launcher-submission-recovery-1.md).
Scoped queue notes:
[`docs/account-pack-scoped-queue-1.md`](docs/account-pack-scoped-queue-1.md).
Scoped staging/readiness notes:
[`docs/scoped-event-staging-readiness-14.md`](docs/scoped-event-staging-readiness-14.md).
Pack metadata/assets notes:
[`docs/pack-metadata-assets-1.md`](docs/pack-metadata-assets-1.md).
Pack library locations notes:
[`docs/pack-library-locations-1.md`](docs/pack-library-locations-1.md).
Season membership check notes:
[`docs/season-membership-check-1.md`](docs/season-membership-check-1.md).
Pack readiness notes:
[`docs/pack-readiness-1.md`](docs/pack-readiness-1.md).
Pack directory model notes:
[`docs/pack-directory-model-1.md`](docs/pack-directory-model-1.md).
Pack library grid notes:
[`docs/pack-library-grid-1.md`](docs/pack-library-grid-1.md).
Account switcher notes:
[`docs/account-switcher-gui-1.md`](docs/account-switcher-gui-1.md).
Remembered sessions notes:
[`docs/account-switcher-gui-2.md`](docs/account-switcher-gui-2.md).

Run it from the repository root:

```powershell
npm.cmd --prefix local/hsl-local-app run gui
```

Or from `local/hsl-local-app`:

```powershell
npm run gui
```

The GUI uses the same effective local config as the CLI. It can run
`diagnose`, competition `play`, `practice`, `submit-all`, local login/logout,
and development-only `sync-plugin`. The account panel signs in with email and
password through Supabase Auth, saves the session in the same
`userData/session.json` used by the CLI, and never sends access or refresh
tokens to the renderer. The password is used only for the login request and is
not written to disk.

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

This is only for the current development pack. The next compatibility layout is
the one documented by `local/pack.example.json`, with MAME inside a `mame/`
subfolder. The final shared-runtime layout removes MAME from packs entirely and
is documented in `local/docs/shared-mame-runtime-blueprint-1.md`.

When a pack opens successfully, the GUI remembers its folder in shared user
data:

```text
userData/packs/recent.json
```

That file stores only `lastOpenedPackDir` and `updatedAt`. It does not copy the
pack, does not store tokens, and does not delete pending events. On the next GUI
start, the launcher tries to reload that pack; if it is missing or invalid, it
shows an aviso and falls back to the local development bridge.

If a submission is moved to `failed`, the GUI treats it as a score that
requires attention, not as deleted data. The queue panel shows `Puntuaciones
con error`, explains that the score is still saved, and lets the player restore
the JSON to `pending` without overwriting existing files. Full queue separation
by account and pack is still planned for a later task.

The GUI now separates the active queue by account and pack under shared
userData:

```text
userData/players/<playerKey>/packs/<packKey>/events/{pending,failed,sent}
```

The MAME plugin may still write captures into the pack-local pending folder.
For the GUI, that folder is staging: after competition play, only new captures
created during that session are adopted into the scoped queue. Existing staging
JSON is left untouched to avoid mixing accounts.

The GUI also has a basic account switcher. It remembers known accounts in
`userData/accounts/known-accounts.json` using only safe presentation data:
email, user id, initials, optional display name/avatar and timestamps. It does
not store passwords in any account file, and `known-accounts.json` never stores
tokens. The GUI can also keep per-account remembered sessions in
`userData/accounts/sessions/<playerKey>.json`, using the same local trust model
as the active `session.json`, so players can switch accounts without typing a
password while the saved session remains valid. Closing session clears only the
active `session.json`; removing a remembered account removes its quick access
session but does not delete local scores.

Library favorites are also scoped to the active account when there is a session:

```text
userData/players/<playerKey>/preferences/favorites.json
```

Without a session, favorites stay in the anonymous fallback
`userData/library/favorites.json`. The launcher does not migrate anonymous
favorites into accounts automatically.

Architecture constraints for that GUI:

- do not store session/account data inside a disposable pack;
- do not assume packs live in `Downloads`;
- do not delete pending submissions when a pack is deleted;
- keep persistent data in shared userData;
- treat `sync-plugin` as temporary development tooling, not as an end-user
  feature.

If the active pack contains optional `metadata.json` and local files under
`assets/`, the GUI uses them to improve the active pack presentation: title,
subtitle, description, credits, hero/logo/cover/icon. Missing metadata or
images are non-fatal and appear only as technical warnings.

The GUI also has a minimal pack library. `Elegir directorio` stores one pack
directory in shared user data:

```text
userData/libraries/pack-directory.json
```

The launcher scans only direct subfolders with `pack.json`, lists detected
packs, and lets the player activate one with `Usar este pack`. `Cambiar
directorio`, `Abrir directorio` and `Reescanear` operate on that single
directory. This reuses the same activation and remembered-pack flow as `Abrir
pack`. The app does not copy, move, download, or delete packs.

The library now presents detected packs as visual cards instead of a technical
list. Cards use local `metadata.json` assets when available, fall back to an HSL
placeholder when no cover/icon/logo exists, show simple local states
(`Listo`, `Con avisos`, `Requiere atencion`, `No disponible`) and mark the
active pack visually without adding a separate select button. The configured
directory stays compact in the UI; full paths, legacy `locations.json` fallback
and warnings remain in development details.

The library controls are compact in the launcher shell: `Biblioteca` shows the
pack count in a pill, the first row has `Añadir ubicación` or `Cambiar ubicación`
and `Filtros`, and the second row keeps the official views `Portadas`, `Lista`, `Iconos`.
Search, season filters, `ORDENAR` and the local `Todos/Favoritos` toggle live in
the collapsible `Filtros`
card. `ORDENAR` uses a criterion select plus a compact up/down toggle for
direction. `Semanas` keeps season groups; `Alfabético`, `Desarrollador` and
`Año` show a flat list after filtering. The pack list scrolls inside the left
panel with a reserved native scrollbar, and the `Iconos`
view uses fixed-size tiles. Library cards show one placeholder week badge,
`ABIERTO`; technical states such as installed, errors and legacy belong in the
selected game detail.

The current visual rule is proportional by view: `Portadas` keeps a 2/3 cover,
`Lista` is a compact horizontal row, and `Iconos` uses a 1/1 122px tile. The
search placeholder is `Escribe aquí...`, active favorite stars use the circuit
accent instead of the warning color, and the star button is square with rounded
corners.

The library is top-aligned and responsive to the sidebar width. The sidebar can
shrink to `320px`. A shared `340px` library breakpoint moves `Portadas` from two
proportional columns to one column and switches the view buttons to icon-only
mode. `Lista` stays compact, and `Iconos` keeps a fixed 122px 1/1 tile. In dark
mode, visible scrollbars use the circuit accent.
Favorites are editable only with an active session; the legacy
`userData/library/favorites.json` is not used as a normal anonymous profile, and
local activity shows a login prompt instead of an empty synced state when there
is no session.

The pack library detects conventional local assets in `pack/assets/` even when
`metadata.json` does not declare them. `cover.*` is used for `Portadas`,
`icon.*` for `Lista` and `Iconos`, and missing assets keep the HSL initials
fallback. Remote, absolute and traversal paths remain rejected.

Before competition play and pending uploads, the GUI now checks whether the
connected account belongs to the season for the active pack `weekId`. Known
non-members, invalid weeks, missing sessions, and packs without `weekId` block
competition and submission. Practice remains available. Temporary network or
server errors allow competition with a warning, but keep submission disabled
until membership can be verified. `Herramientas de desarrollo > Detalles
tecnicos` shows the safe membership diagnostics: final URL, HTTP status, body
status, body message, checked time, `weekId`, `seasonId`, and technical reason.
It never exposes tokens or the `Authorization` header. The action `Comprobar de
nuevo` recalculates only the active pack membership.

The GUI also summarizes whether the active pack is ready before play. It checks
pack metadata, MAME, ROM, capture/plugin state, local session, scoped queue,
membership and auto-sync state, then shows a player-friendly status for
practice, competition and upload readiness. For v1/dev bridge, plugin event
folders are staging. For v2, `userData/events` is only a legacy/CLI fallback and
is not shown as staging for the active pack. Technical checks stay in
development details and never expose secrets.

This prototype is not packaged, not an installer, and not the final pack picker.
Pack opening is the first incremental step toward the final pack flow, not
complete multi-pack management.
The final direction is documented as a local pack library and player launcher
in [`docs/launcher-final-ux-blueprint-1.md`](docs/launcher-final-ux-blueprint-1.md).

`LOCAL-LAUNCHER-SHELL-LAYOUT-2` convierte la GUI en un shell de escritorio:
header fijo, biblioteca izquierda con scroll propio, detalle derecho estable,
actividad en drawer, opciones avanzadas en drawer y cuenta compacta en el
header. El minimo de ventana Electron es `1200x780`. No cambia MAME, runtime,
colas, membership, payloads, endpoints ni contratos de pack.

`LOCAL-LAUNCHER-SHELL-BUGFIX-3` corrige el ancho completo del shell/header,
separa backdrop y body de drawers, evita que clicks internos cierren drawers o
menu de cuenta, arregla el scroll de drawers y compacta cards sin assets. No
toca funcionalidad local ni `config.json`.

`LOCAL-LAUNCHER-VISUAL-FOUNDATION-1` limpia la primera capa visual del
launcher: header con slot de icono, sin refresco protagonista, biblioteca con
contador `1 pack`, detalle con chips humanos, botonera `Jugar`/`Practicar`/
`Manual`/`Ranking`, actividad local como subtarjeta y opciones avanzadas fuera
del flujo normal con acceso por `Ctrl+Shift+D`. No toca MAME, runtime, plugin,
colas, membership, endpoints, payloads, RLS ni `config.json`.

## Mega product pass 1

`LOCAL-LAUNCHER-MEGA-PRODUCT-PASS-1` reorganiza la GUI alrededor de biblioteca,
detalle del juego y actividad local. Añade agrupación por temporadas, vistas de
portadas/lista/iconos, búsqueda y filtros locales, manual seguro y fallback de
ranking a `/weeks/<weekId>`.

La competición v2 para packs válidos usa preparación aislada por ejecución:
la app copia el plugin controlado y `capture.adapter` a
`userData/runtime/runs/<runId>`, genera `config.lua` y adopta capturas nuevas al
scope de cuenta + pack. Readiness y diagnose explican modo, plugin, adaptador,
staging y legacy. Consulta:

- [`docs/mame-pack-plugin-loading-1.md`](docs/mame-pack-plugin-loading-1.md)
- [`docs/mame-pack-plugin-loading-2.md`](docs/mame-pack-plugin-loading-2.md)
- [`docs/launcher-ux-revamp-1.md`](docs/launcher-ux-revamp-1.md)
- [`docs/pack-library-seasons-1.md`](docs/pack-library-seasons-1.md)
- [`docs/pack-library-views-1.md`](docs/pack-library-views-1.md)
- [`docs/manual-viewer-1.md`](docs/manual-viewer-1.md)
- [`docs/activity-details-1.md`](docs/activity-details-1.md)
- [`docs/ranking-viewer-1.md`](docs/ranking-viewer-1.md)
- [`docs/legacy-deprecation-plan.md`](docs/legacy-deprecation-plan.md)

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

For the modern GUI, this resolved file queue is compatibility state unless it
is explicitly being used as v1/dev bridge staging. The player-facing queue for
the active account and pack is:

```text
userData/players/<playerKey>/packs/<packKey>/events
```

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

The current CLI launcher reads the effective development config. For legacy v1
packs it can still resolve `mame.relativeExecutablePath` relative to the pack,
but that model is deprecated. The product launcher should read `packVersion: 2`,
combine the active pack resources with the shared MAME runtime, and avoid
shipping MAME per pack. Uploads still require `submit` or `submit-all`. Future
phases can add F12 capture, automatic Game Over capture, official DIP
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

## Local launcher visual status

The local GUI now has a player-facing first layer for the selected game: a
contained horizontal hero, title/logo/week, human status chips, local metadata,
four primary actions, and a compact activity summary. Technical diagnostics,
runtime paths, scoped queue details, membership internals, readiness checks,
legacy sync tools, and raw local paths stay in advanced drawers.

See:

```text
local/docs/game-detail-polish-1.md
local/docs/library-cards-1.md
```
