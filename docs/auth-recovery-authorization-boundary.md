# Recovery web boundary

Recovery es una sesión Supabase temporal y físicamente aislada, no una sesión
privada normal de High Score League. El cliente server exclusivo usa el storage
namespace y nombre de cookie `hsl-recovery-auth`; todos sus chunks tienen
`Path=/reset-password`, `HttpOnly`, `SameSite=Lax`, `Secure` en producción y una
vida máxima real de 15 minutos.

El cliente Auth normal mantiene su propio namespace y sirve al resto de HSL. El
middleware, Root Layout, SiteNav, Presence y las APIs no crean ni interpretan el
cliente Recovery. Por el scope de navegador, las cookies Recovery llegan a
`/reset-password` y sus descendientes, pero no a `/`, `/profile`, `/admin`,
`/api/*`, `/auth/*` ni a los endpoints launcher.

`verifyOtp({ token_hash, type: "recovery" })` valida el token Recovery, pero HSL
no utiliza el método de autenticación del JWT para identificar la sesión
resultante. La procedencia queda demostrada por el endpoint POST humano que crea
la sesión exclusivamente mediante el cliente aislado. En particular, un método
resultante `otp` no se reinterpreta ni provoca rechazo.

## Cookies y autoridad

- `hsl_password_recovery_staged`: prueba efímera de que el enlace entregó un
  token; sólo existe bajo `/auth/recovery` y no es una sesión.
- `hsl_password_recovery_authorized`: marker de que el POST humano ya verificó
  el token; no es una credencial Supabase.
- `hsl_password_recovery_logout_pending`: conserva el retry cuando la contraseña
  cambió pero falló el logout global.
- `hsl-recovery-auth`, `hsl-recovery-auth.0`, `.1`, etc.: sesión Supabase
  temporal que puede ejecutar `getUser`, `updateUser` y los logouts del workflow.

El formulario y el POST de completion exigen a la vez marker autorizado y
`getUser()` válido sobre el cliente Recovery. Los errores corregibles conservan
esa sesión para reintentar. Cancelar ejecuta logout local sólo en Recovery y
borra defensivamente todos los chunks inventariados; completar ejecuta
`updateUser`, después logout global y finalmente limpia staging, markers y todos
los chunks.

El adaptador de cookies impone 900 segundos a cada escritura viva aunque
`@supabase/ssr` proponga su máximo por defecto, conserva `maxAge=0` y `expires`
en borrados, y propaga a los redirects los headers no-cache generados por el
paquete. No existe un límite codificado de chunks: el cleanup parte de
`cookies().getAll()` y elimina el nombre base y cualquier nombre con el prefijo
`hsl-recovery-auth.` usando el mismo path de creación.

Como `/auth/*` no recibe cookies limitadas a `/reset-password`, la cancelación
previa y una verificación inválida encadenan un POST interno al path Recovery
antes del redirect final. Así el cleanup puede inventariar los chunks reales sin
llamar a Supabase ni ampliar el scope de la cookie.

Si el navegador ya tenía una sesión HSL normal, ambas sesiones pueden coexistir
en namespaces independientes. Verificar Recovery no sobrescribe la normal,
cancelar Recovery no la cierra y la navegación normal no toma identidad de
Recovery. Tras cambiar la contraseña, el logout global puede revocar las demás
sesiones renovables de la cuenta; el flujo no crea una sesión HSL normal nueva y
termina en Login para autenticación manual.

Esta frontera no cambia PostgreSQL, RLS, Storage, roles SQL ni funciones
`SECURITY DEFINER`. Los endpoints cookie y Bearer continúan verificando la sesión
normal mediante `auth.getUser()`.

## Riesgo residual

El aislamiento depende del contrato de storage de la versión instalada de
`@supabase/ssr`, donde `cookieOptions.name` se aplica como `storageKey`, y del
scope de cookies que implementa el navegador. Por eso el build y los tests
contractuales deben volver a validarse al actualizar ese paquete. El QA con un
correo real queda para después del despliegue, para no consumir tokens durante
la implementación.

## QA manual pendiente

1. Solicitar un enlace nuevo y abrirlo.
2. Confirmar que el GET deja una URL limpia y no consume el token.
3. Pulsar **Continuar** y comprobar que aparece `/reset-password`, sin error de
   enlace inválido.
4. Partiendo de un navegador sin sesión previa, comprobar que `/`, `/profile`,
   navegación y Presence siguen desconectados.
5. Probar password débil y misma password; ambos permiten retry.
6. Cancelar y comprobar que termina sólo Recovery local.
7. Repetir Recovery y establecer una password válida.
8. Comprobar logout global, Login manual con la password nueva y launcher normal.
9. Repetir desde un navegador que ya tenga sesión HSL normal y comprobar que la
   verificación no sobrescribe su cookie normal.

No es necesario comprobar Data API o Storage con Recovery.
