import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RealProfile } from "@/types/supabase";

export const dynamic = "force-dynamic";

type TestResult = {
  table: "seasons" | "games" | "weeks";
  count: number | null;
  rows: Array<Record<string, unknown>>;
  error: string | null;
};

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

async function readTable(
  supabase: SupabaseServerClient | null,
  table: TestResult["table"],
): Promise<TestResult> {
  if (!supabase) {
    return {
      table,
      count: null,
      rows: [],
      error: "Supabase no está configurado.",
    };
  }

  const columnsByTable: Record<TestResult["table"], string> = {
    seasons: "id,name,slug,status",
    games: "id,title,developer,year",
    weeks: "id,week_number,status,public_start_at,final_deadline_at",
  };

  const { data, error, count } = await supabase
    .from(table)
    .select(columnsByTable[table], { count: "exact" })
    .limit(5);

  return {
    table,
    count,
    rows: (data ?? []) as unknown as Array<Record<string, unknown>>,
    error: error ? `${error.message}${error.code ? ` (${error.code})` : ""}` : null,
  };
}

export default async function SupabaseTestPage() {
  const env = getSupabaseEnv();
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  if (!env.isConfigured) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader title="Supabase test" eyebrow="Conexión">
            Faltan variables de entorno para conectar con Supabase.
          </CardHeader>
          <EmptyState
            title="Supabase no está configurado."
            description={`Configura .env.local con: ${env.missing.join(", ")}.`}
          />
          <div className="mt-5 rounded-lg border p-4 text-sm theme-border theme-surface-muted">
            <p className="font-semibold theme-text">Ejemplo:</p>
            <pre className="mt-2 overflow-x-auto theme-text-muted">
              NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co{"\n"}
              NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
            </pre>
          </div>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const profileResponse =
    supabase && userData.user
      ? await supabase
          .from("profiles")
          .select("id,username,initials,avatar_url,is_admin,created_at,updated_at")
          .eq("id", userData.user.id)
          .maybeSingle()
      : { data: null, error: null };
  const realProfile = (profileResponse.data ?? null) as RealProfile | null;
  const metadataUsername =
    typeof userData.user?.user_metadata.username === "string"
      ? userData.user.user_metadata.username
      : null;
  const metadataInitials =
    typeof userData.user?.user_metadata.initials === "string"
      ? userData.user.user_metadata.initials
      : null;
  const metadataMatchesProfile =
    realProfile && metadataUsername && metadataInitials
      ? realProfile.username === metadataUsername &&
        realProfile.initials === metadataInitials.toUpperCase()
      : null;
  const results = await Promise.all([
    readTable(supabase, "seasons"),
    readTable(supabase, "games"),
    readTable(supabase, "weeks"),
  ]);
  const hasErrors = results.some((result) => result.error);
  const totalRows = results.reduce((total, result) => total + (result.count ?? 0), 0);
  const hasZeroVisibleRows = !hasErrors && totalRows === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Supabase test"
          eyebrow="Conexión"
          action={
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
                hasErrors
                  ? "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]"
                  : "border-emerald-300 bg-emerald-100 text-emerald-900"
              }`}
            >
              {hasErrors ? "Con errores" : "Conectado"}
            </span>
          }
        >
          Prueba aislada de conexión, Auth y lectura básica de tablas protegidas.
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-3">
          {results.map((result) => (
            <div
              className="rounded-lg border p-4 theme-border theme-surface-muted"
              key={result.table}
            >
              <p className="text-xs font-semibold uppercase theme-text-muted">
                {result.table}
              </p>
              <p className="mt-2 text-2xl font-bold theme-text">
                {result.count ?? 0}
              </p>
              <p className="mt-1 text-sm theme-text-muted">
                {result.error ? "Error al leer" : "Filas visibles"}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm theme-text-muted">
          Total visible reportado por Supabase: {totalRows} filas.
        </p>
        {hasZeroVisibleRows ? (
          <p className="mt-2 text-sm theme-text-muted">
            Hay conexión, pero no hay filas visibles. Puede ser normal si las tablas no
            tienen seed o si RLS no expone datos para esta sesión.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Sesión" eyebrow="Auth" />
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Variables
            </p>
            <p className="mt-2 font-semibold theme-text">
              {env.isConfigured ? "Configuradas" : "Faltan variables"}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              Service role servidor: {hasServiceRoleKey ? "configurada" : "no configurada"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Sesión
            </p>
            <p className="mt-2 font-semibold theme-text">
              {userData.user ? "Activa" : "Sin sesión"}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              {userData.user?.email ?? "No autenticado"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Metadata
            </p>
            <p className="mt-2 font-semibold theme-text">
              {metadataInitials ?? "-"} {metadataUsername ? `@${metadataUsername}` : ""}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              Username e initials guardados en Auth.
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              User ID
            </p>
            <p className="mt-2 break-all text-sm font-semibold theme-text">
              {userData.user?.id ?? "-"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Perfil
            </p>
            <p className="mt-2 font-semibold theme-text">
              {realProfile
                ? `${realProfile.initials} · @${realProfile.username}`
                : "No visible"}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              {profileResponse.error
                ? profileResponse.error.message
                : realProfile
                  ? realProfile.is_admin
                    ? "Admin"
                    : "Jugador"
                  : userData.user
                    ? "Falta perfil o RLS lo oculta"
                    : "Inicia sesión para comprobar perfil"}
            </p>
          </div>
          <div className="rounded-lg border p-4 theme-border theme-surface-muted">
            <p className="text-xs font-semibold uppercase theme-text-muted">
              Metadata vs perfil
            </p>
            <p className="mt-2 font-semibold theme-text">
              {metadataMatchesProfile === null
                ? "No comprobable"
                : metadataMatchesProfile
                  ? "Coinciden"
                  : "No coinciden"}
            </p>
            <p className="mt-1 text-sm theme-text-muted">
              Si no coinciden, guarda el perfil desde /profile.
            </p>
          </div>
        </div>
        {!userData.user && (hasErrors || hasZeroVisibleRows) ? (
          <p className="mt-4 text-sm theme-text-muted">
            Si RLS bloquea lecturas sin sesión, es esperable hasta iniciar sesión o
            definir políticas públicas de lectura.
          </p>
        ) : null}
      </Card>

      {results.map((result) => (
        <Card key={result.table}>
          <CardHeader title={result.table} eyebrow="Resultado" />
          {result.error ? (
            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              Error de lectura: {result.error}. Si no hay sesión, puede ser RLS.
            </div>
          ) : result.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border theme-border">
              <table className="min-w-full text-left text-sm">
                <thead className="theme-table-head">
                  <tr>
                    {Object.keys(result.rows[0]).map((key) => (
                      <th className="px-4 py-3 font-semibold uppercase" key={key}>
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y theme-border theme-surface">
                  {result.rows.map((row, index) => (
                    <tr className="theme-hover" key={`${result.table}-${index}`}>
                      {Object.entries(row).map(([key, value]) => (
                        <td className="whitespace-nowrap px-4 py-3 theme-text-muted" key={key}>
                          {String(value ?? "-")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin filas visibles."
              description="La conexión funciona, pero esta tabla no tiene datos visibles para la sesión actual."
            />
          )}
        </Card>
      ))}
    </div>
  );
}


