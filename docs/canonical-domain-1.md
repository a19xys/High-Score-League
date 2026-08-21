# Dominio canónico web

Desde `WEB-CANONICAL-DOMAIN-1`, el origen oficial anunciado por High Score
League es:

```text
https://highscoreleague.com
```

`NEXT_PUBLIC_SITE_URL=https://highscoreleague.com` debe existir en Vercel
Production. El código valida la variable como un origen exacto y, si falta o es
inválida, usa el mismo dominio oficial como fallback seguro. No se usan
`VERCEL_URL`, `NEXT_PUBLIC_VERCEL_URL`, el header `Host` ni el origen de la
request para decidir la autoridad del producto.

## Contrato de hosts

- `https://highscoreleague.com` es la autoridad de metadata, canonical y enlaces
  absolutos nuevos de HSL.
- `https://www.highscoreleague.com` redirige al apex mediante Vercel.
- `https://high-score-league.vercel.app` sigue sirviendo Production directamente
  y no se redirige globalmente. Se mantiene por compatibilidad con el launcher
  `0.3.0`.
- Las cookies y sesiones de ambos hosts son independientes; no se transfieren ni
  se comparten entre dominios.

La Home declara canonical `/` sobre el `metadataBase` oficial. Por ello, incluso
cuando se solicita mediante el alias legacy, el HTML anuncia
`https://highscoreleague.com/`.

## Recovery y registro

Recovery conserva el origen de runtime sólo para loopback en desarrollo
(`localhost`, `127.0.0.1` o `::1`). Todo runtime público —apex, alias legacy o
preview— envía `https://highscoreleague.com/auth/recovery/start` a Supabase.

Registro no añade `emailRedirectTo`: continúa usando el Site URL configurado en
Supabase, evitando una segunda autoridad.

La configuración remota conocida es:

```text
Supabase Site URL:
https://highscoreleague.com

Supabase Redirect URLs:
https://highscoreleague.com/auth/recovery/start
https://high-score-league.vercel.app/auth/recovery/start
http://localhost:3000/auth/recovery/start
```

## Excepción de compatibilidad del launcher

`POST /api/launcher/ranking-capabilities` conserva deliberadamente
`request.nextUrl.origin` al construir URLs de semana. Un launcher que llama al
host legacy recibe URLs legacy; uno que llama al apex recibe URLs del apex. Esta
frontera no debe cambiarse por la autoridad canónica web.

El smoke `npm run test:launcher-api` usa el apex por defecto, no sigue redirects
HTTP y admite `HSL_LAUNCHER_API_BASE_URL` para comprobar el alias legacy.

## QA posterior al deploy

Este checklist es manual y no se considera completado hasta ejecutarlo sobre el
deployment resultante:

1. Abrir `https://highscoreleague.com` y comprobar el canonical del HTML.
2. Abrir `https://high-score-league.vercel.app` y confirmar que no redirige.
3. Confirmar que la Home legacy declara `https://highscoreleague.com/` como
   canonical.
4. Iniciar recovery desde el apex y comprobar que el email apunta al dominio
   canónico.
5. Iniciar recovery desde `.vercel.app` y comprobar que el nuevo email también
   apunta al dominio canónico.
6. Crear una cuenta desechable y confirmar que la verificación usa el Site URL
   canónico de Supabase.
7. Probar Login y Logout normalmente en el dominio nuevo.
8. Consultar `/api/launcher/health` por HTTP bajo ambos hosts y confirmar `204`
   sin redirect.
9. Ejecutar el smoke contra el apex y contra el alias mediante override.
10. Confirmar que el launcher `0.3.0` continúa funcionando contra el host legacy.
