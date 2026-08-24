# LOCAL-COMPETITION-INTEGRITY-CLOSURE-FIX-1

Este cierre corrige seis fronteras del contrato local ya congelado. No crea
`competitionIntegrity v3`, Pack Contract v3 ni cambios WEB.

## Seis correcciones

1. **Autoridad protected app-owned.** `requiresProtectedCompetitionEvidence()`
   deriva la obligación del contrato del pack/scope. Evidence ausente, v1 o v2
   inválida se rechaza antes de auth y HTTP; un scope legacy real sigue siendo
   compatible.
2. **Observación independiente de outputs.** El launcher vigila candidates y
   commitments mientras MAME vive y conserva el primer SHA-256 de los bytes
   exactos. Cambio, restauración, ausencia de observación o fallo del watcher
   impiden CLEAN.
3. **Estado app-side sticky.** El monitor mantiene violaciones en memoria,
   escribe un marker de armado y markers monotónicos por violación. Estado
   ausente/corrupto después de armado no significa limpio.
4. **Frontera ASAR física.** La root virtual dentro de `app.asar` conserva
   verificación pre/post; la vigilancia live usa el archivo físico `app.asar`,
   nunca la entry virtual. El smoke packaged ejecuta el monitor dentro del
   `appPath` empaquetado real.
5. **CFG seed separado.** `seeds/cfg/` es inmutable y manifest-covered;
   `cfg/` es la copia runtime mutable. Se verifican manifest y materialización
   inmediatamente antes de spawn.
6. **Visual common-only normalizado.** Todos los spellings aceptados por el
   parser convergen a `-video` y `-bgfx_screen_chains`; los perfiles protegidos
   no pueden ocultar aliases y el par común debe aparecer exactamente una vez.

## App close seal

Tras cerrar MAME, drenar watchers, repetir hashes y escribir `mame-exit.json`,
el launcher crea `integrity/app/app-close-seal.json`. Liga `runId`, input
manifest, exit, violaciones app-owned, hashes de `final.marker` y ledger, y los
hashes observados de cada candidate/commitment. Es estado local app-owned, no
una firma ni atestación. El finalizer y recovery fallan cerrado si falta, está
corrupto o contradice cualquier byte final.

## Contratos preservados

- evidence/guard v2, player binding v1 y duplicate key `hsl:v2`;
- Pack Contract v2, competition-manifest v1 y run-input-manifest v1;
- finalized-run receipt sin campos públicos nuevos;
- MAME 0.287, plugin hsl-score 0.4.0 y launcher source 0.3.0;
- Space Invaders `space-invaders-s1-w1-r2`, sin r3 ni publicación.

El límite aceptado permanece: una reescritura coherente de launcher/ASAR y de
toda la autoridad app-owned, un SO hostil o instrumentación del proceso quedan
fuera de LOCAL y corresponden a la futura autoridad WEB.
