# Preferencias locales por jugador (`LOCAL-PLAYER-PREFERENCES-2`)

## Autoridad y scopes

Las preferencias visuales se resuelven desde la cuenta local activa de
`userData/accounts/known-accounts.json` (`lastActiveUserId`). La sesión remota,
conectividad, membership, Presence y Ranking no intervienen. El descriptor que llega al
renderer solo contiene identidad lógica:

```text
global
player:<playerKey>
```

No contiene rutas, email, sesión ni tokens. La derivación competitiva
`derivePlayerKey(session)` no se amplió: colas, Playtime, favoritos y competición
conservan sus guards de sesión.

## Persistencia

```text
userData/
  players/<playerKey>/preferences/
    library.json
    favorites.json
    theme.json
  library/preferences.json
  library/favorites.json        # compatibilidad legacy; no se escribe sin sesión
  hsl/preferences/theme.json    # scope global/sin cuenta
```

`library.json` persiste únicamente `libraryView`, `librarySortBy`,
`librarySortDirection` y `sidebarWidth`. Consulta, filtros abiertos, selección, foco,
busy y scroll siguen siendo efímeros. Las escrituras son snapshots completos,
atómicos y serializados por scope; A y B tienen colas independientes.

`theme.json` mantiene el schema v1 (`mode`, `manualTheme`, `lastSystemTheme`,
`effectiveTheme`, `updatedAt`). La autoridad sigue en `main`. El antiguo tema global
puede sembrar como máximo al primer player elegible mediante un marker durable; el
fichero global se conserva y los players posteriores empiezan desde su propio fichero o
el tema del sistema. La protección del fichero nativo `userData/preferences` continúa
intacta.

## Transiciones y concurrencia

Cada snapshot aceptado pasa primero por la revisión monotónica. Si cambia el scope, el
renderer aplica en un solo patch identidad, las cuatro preferencias de Biblioteca y el
tema efectivo. Un snapshot del mismo scope no rehidrata controles ya modificados por el
usuario; A→B→A sí hidrata los tres cambios legítimos.

El debounce captura el `scopeKey` y el snapshot visible al nacer. Antes de login,
switch, logout u olvido de cuenta se hace flush del scope saliente. Main valida la
identidad lógica y resuelve la ruta; el renderer nunca puede elegirla. Una escritura de
tema también captura su scope: si A termina después de activar B, persiste en A pero no
cambia el renderer ni el chrome nativo de B.

Abrir el formulario `requiresLogin` o fallar un login no cambia el scope. Olvidar una
cuenta inactiva tampoco. Logout u olvido de la activa siguen el resultado canónico del
account store y nunca borran los ficheros de preferencias.

## Startup

Antes de crear `BrowserWindow`, main lee localmente `lastActiveUserId`, resuelve el tema
de ese scope y usa su color para `backgroundColor`, argumento de preload y bootstrap
anterior al CSS. No espera red. Un store de cuentas ilegible cae a global con el launcher
utilizable.

El cambio de cuenta actualiza `data-theme`, `color-scheme`, fondo y titlebar nativos sin
reload ni remount global. Los invariantes incrementales de Biblioteca siguen vigentes:
un cambio real de View puede cambiar topología; un cambio solo de tema o anchura no
reconstruye las cards.
