"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteAccountButton } from "@/components/auth/delete-account-button";
import { LogoutButton } from "@/components/auth/logout-button";
import { SubmissionsTable } from "@/components/submissions-table";
import { ThemeSelect } from "@/components/theme-select";
import { PlaceholderSection } from "@/components/ui/state";
import { formatExactDateTime, formatScore } from "@/lib/format";
import {
  humanizeSupabaseError,
  normalizeInitials,
  validateInitials,
  validateUsername,
} from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Game, Submission, Week } from "@/types";
import type { RealProfile } from "@/types/supabase";

type ProfileSection = "general" | "settings" | "history" | "advanced";

type ProfileSubmission = Submission & {
  week?: Week;
  game?: Game;
};

export type ProfileStats = {
  victories: number;
  podiums: number;
  participations: number;
  officialResults: number;
};

export type ProfileBestScore = {
  week: Week;
  game?: Game;
  bestScore: number;
  uploads: number;
  latestAt: string;
};

export type ProfileAuthData =
  | { status: "not-configured" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      email: string;
      profile: RealProfile | null;
      profileError: string | null;
      metadataUsername: string;
      metadataInitials: string;
    };

type AdminCenterData = {
  isAdmin: boolean;
  currentWeekId?: string;
  currentWeekLabel?: string;
  activeWeekCount?: number;
  error?: string | null;
};

type ProfileDashboardProps = {
  auth: ProfileAuthData;
  adminCenter: AdminCenterData;
  stats: ProfileStats;
  recentSubmissions: ProfileSubmission[];
  bestScores: ProfileBestScore[];
};

const sections: Array<{ id: ProfileSection; label: string; adminOnly?: boolean }> = [
  { id: "general", label: "General" },
  { id: "settings", label: "Ajustes" },
  { id: "history", label: "Historial" },
  { id: "advanced", label: "Opciones avanzadas", adminOnly: true },
];

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function profileInitials(profile: RealProfile | null) {
  return profile?.initials ?? "HSL";
}

function profileUsername(profile: RealProfile | null) {
  return profile?.username ? `@${profile.username}` : "Perfil pendiente";
}

function ProfileAvatar({ profile, size = "large" }: { profile: RealProfile | null; size?: "large" | "small" }) {
  const className =
    size === "large"
      ? "h-24 w-24 text-2xl"
      : "h-12 w-12 text-sm";

  if (profile?.avatar_url) {
    return (
      <img
        alt={`Avatar de ${profile.username}`}
        className={`${className} rounded-full object-cover theme-surface-strong`}
        src={profile.avatar_url}
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center rounded-full font-bold theme-surface-strong theme-text`}
    >
      {profileInitials(profile)}
    </div>
  );
}

function SignedOutState({ status }: { status: "not-configured" | "signed-out" }) {
  const title =
    status === "not-configured"
      ? "Supabase no está configurado"
      : "Necesitas iniciar sesión";
  const description =
    status === "not-configured"
      ? "Configura las variables de entorno para usar el perfil real."
      : "Inicia sesión para ver y editar tu perfil de High Score League.";

  return (
    <div className="rounded-lg border p-6 theme-border theme-surface">
      <p className="text-xl font-bold theme-text">{title}</p>
      <p className="mt-2 max-w-xl theme-text-muted">{description}</p>
      {status === "signed-out" ? (
        <Link
          className="mt-5 inline-flex rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong"
          href="/login"
        >
          Ir a login
        </Link>
      ) : null}
    </div>
  );
}

function AdminCenter({ data }: { data: AdminCenterData }) {
  if (!data.isAdmin) {
    return null;
  }

  const currentWeekHref =
    data.currentWeekId && data.activeWeekCount === 1
      ? "/admin/weeks/current"
      : "/admin/weeks";

  return (
    <div className="rounded-lg border p-5 theme-border theme-surface">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase theme-text-muted">
            Administración
          </p>
          <h2 className="mt-1 text-xl font-bold theme-text">Centro admin</h2>
          <p className="mt-2 max-w-2xl text-sm theme-text-muted">
            Accesos directos a la gestión real de la liga.
          </p>
        </div>
        <span className="w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
          Admin
        </span>
      </div>
      {data.error ? (
        <div className="mt-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          {data.error}
        </div>
      ) : null}
      {data.activeWeekCount && data.activeWeekCount > 1 ? (
        <div className="mt-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          Hay {data.activeWeekCount} semanas activas. Revisa la configuración.
        </div>
      ) : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href={currentWeekHref}
        >
          <p className="font-semibold theme-text">Semana activa</p>
          <p className="mt-2 text-sm theme-text-muted">
            {data.currentWeekLabel ?? "No hay semana activa"}
          </p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/weeks"
        >
          <p className="font-semibold theme-text">Semanas</p>
          <p className="mt-2 text-sm theme-text-muted">Operación semanal.</p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/seasons"
        >
          <p className="font-semibold theme-text">Temporadas</p>
          <p className="mt-2 text-sm theme-text-muted">Gestión de temporadas.</p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/games"
        >
          <p className="font-semibold theme-text">Juegos</p>
          <p className="mt-2 text-sm theme-text-muted">Catálogo real.</p>
        </Link>
        <Link
          className="rounded-lg border p-4 theme-border theme-surface-muted theme-hover"
          href="/admin/polls"
        >
          <p className="font-semibold theme-text">Cuestionarios</p>
          <p className="mt-2 text-sm theme-text-muted">Pregunta única de Home.</p>
        </Link>
        <div className="rounded-lg border p-4 opacity-70 theme-border theme-surface-muted">
          <p className="font-semibold theme-text">Usuarios</p>
          <p className="mt-2 text-sm theme-text-muted">Próximamente.</p>
        </div>
      </div>
    </div>
  );
}

function ProfileForm({
  auth,
  onProfileSaved,
}: {
  auth: Extract<ProfileAuthData, { status: "signed-in" }>;
  onProfileSaved: (profile: RealProfile) => void;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(
    auth.profile?.username ?? auth.metadataUsername,
  );
  const [initials, setInitials] = useState(
    auth.profile?.initials ?? auth.metadataInitials,
  );
  const [bio, setBio] = useState(auth.profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(auth.profile?.avatar_url ?? "");
  const [trackPlayTime, setTrackPlayTime] = useState(
    auth.profile?.track_play_time ?? true,
  );
  const [error, setError] = useState<string | null>(auth.profileError);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const cleanUsername = username.trim();
    const cleanInitials = normalizeInitials(initials);
    const cleanBio = bio.trim();
    const cleanAvatarUrl = avatarUrl.trim();
    const usernameError = validateUsername(cleanUsername);
    const initialsError = validateInitials(cleanInitials);

    if (usernameError || initialsError) {
      setError(usernameError ?? initialsError);
      return;
    }

    if (cleanAvatarUrl && !isHttpUrl(cleanAvatarUrl)) {
      setError("La URL del avatar debe empezar por http o https.");
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase no está configurado. Revisa .env.local.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setError("La sesión ha caducado. Vuelve a iniciar sesión.");
      return;
    }

    const payload = {
      username: cleanUsername,
      initials: cleanInitials,
      bio: cleanBio || null,
      avatar_url: cleanAvatarUrl || null,
      track_play_time: trackPlayTime,
    };

    setIsSubmitting(true);
    const response = auth.profile
      ? await supabase
          .from("profiles")
          .update(payload)
          .eq("id", userData.user.id)
          .select(
            "id,username,initials,avatar_url,bio,track_play_time,is_admin,created_at,updated_at",
          )
          .single()
      : await supabase
          .from("profiles")
          .insert({ id: userData.user.id, ...payload })
          .select(
            "id,username,initials,avatar_url,bio,track_play_time,is_admin,created_at,updated_at",
          )
          .single();
    setIsSubmitting(false);

    if (response.error) {
      setError(humanizeSupabaseError(response.error.message));
      return;
    }

    const profile = response.data as RealProfile;
    const metadataUpdate = await supabase.auth.updateUser({
      data: {
        username: profile.username,
        initials: profile.initials,
      },
    });

    if (metadataUpdate.error) {
      setError(humanizeSupabaseError(metadataUpdate.error.message));
      return;
    }

    setUsername(profile.username);
    setInitials(profile.initials);
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? "");
    setTrackPlayTime(profile.track_play_time ?? true);
    onProfileSaved(profile);
    setMessage("Perfil guardado correctamente.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold theme-text">Username</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="lauravc"
            required
            value={username}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            3-20 caracteres: minúsculas, números y guion bajo. Debe empezar por
            letra.
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold theme-text">Siglas</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 uppercase theme-input"
            maxLength={3}
            onChange={(event) => setInitials(normalizeInitials(event.target.value))}
            placeholder="LVC"
            required
            value={initials}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            3 caracteres: letras A-Z o números. Se guardan en mayúsculas.
          </span>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">Descripción</span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setBio(event.target.value)}
            placeholder="Sin descripción todaví­a."
            value={bio}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            Bio pública del jugador. Puede quedar vací­a.
          </span>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">Avatar</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://..."
            value={avatarUrl}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            URL temporal de imagen. La subida de archivo queda pendiente.
          </span>
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-lg border p-4 theme-border theme-surface-muted">
        <input
          checked={trackPlayTime}
          className="mt-1"
          onChange={(event) => setTrackPlayTime(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block font-semibold theme-text">
            Permitir registrar mi tiempo de juego
          </span>
          <span className="mt-1 block text-sm theme-text-muted">
            Preferencia preparada para la app local. El tiempo de juego real aún
            no se calcula.
          </span>
        </span>
      </label>

      {error ? (
        <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-sm theme-text-muted">{message}</p> : null}

      <button
        className="rounded-md px-4 py-3 text-sm font-semibold theme-surface-strong disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Guardando..." : "Guardar cambios"}
      </button>
    </form>
  );
}

export function ProfileDashboard({
  auth,
  adminCenter,
  stats,
  recentSubmissions,
  bestScores,
}: ProfileDashboardProps) {
  const signedIn = auth.status === "signed-in" ? auth : null;
  const [profile, setProfile] = useState<RealProfile | null>(
    signedIn?.profile ?? null,
  );
  const [activeSection, setActiveSection] = useState<ProfileSection>(
    signedIn?.profile ? "general" : "settings",
  );
  const visibleSections = sections.filter(
    (section) => !section.adminOnly || adminCenter.isAdmin,
  );
  const statCards = useMemo(
    () => [
      {
        label: "Victorias oficiales",
        value: String(stats.victories),
        help: "Primeros puestos confirmados en resultados oficiales.",
        provisional: false,
      },
      {
        label: "Podios oficiales",
        value: String(stats.podiums),
        help: "Primeros, segundos o terceros puestos confirmados.",
        provisional: false,
      },
      {
        label: "Participaciones",
        value: String(stats.participations),
        help: "Semanas con actividad real registrada.",
        provisional: false,
      },
      {
        label: "Campeonatos",
        value: "Pendiente",
        help: "Se calculará cuando se cierre el flujo de temporadas.",
        provisional: true,
      },
      {
        label: "Medallas",
        value: "Pendiente",
        help: "Sistema de medallas todaví­a no implementado.",
        provisional: true,
      },
      {
        label: "Tiempo jugado",
        value: "Pendiente",
        help: "La app local aún no enví­a tiempo de juego.",
        provisional: true,
      },
    ],
    [stats],
  );

  if (auth.status === "not-configured" || auth.status === "signed-out") {
    return <SignedOutState status={auth.status} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="h-fit rounded-lg border p-3 theme-border theme-surface">
        <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {visibleSections.map((section) => (
            <button
              className={`w-full rounded-md px-3 py-2 text-left text-sm font-semibold theme-hover ${
                activeSection === section.id
                  ? "bg-[var(--hover)] theme-text"
                  : "theme-text-muted"
              }`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="space-y-6">
        {activeSection === "general" ? (
          <>
            <div className="rounded-lg border p-6 theme-border theme-surface">
              <p className="text-xs font-semibold uppercase theme-text-muted">
                Perfil
              </p>
              <div className="mt-5 flex flex-wrap items-start gap-5">
                <ProfileAvatar profile={profile} />
                <div className="max-w-2xl">
                  <p className="text-4xl font-bold theme-text">
                    {profile?.initials ?? "Perfil pendiente"}
                  </p>
                  <p className="mt-1 theme-text-muted">{profileUsername(profile)}</p>
                  <p className="mt-1 text-sm theme-text-muted">{auth.email}</p>
                  <p className="mt-4 leading-7 theme-text">
                    {profile?.bio ?? "Sin descripción todaví­a."}
                  </p>
                  {profile?.created_at ? (
                    <p
                      className="mt-3 text-xs theme-text-muted"
                      title={formatExactDateTime(profile.created_at)}
                    >
                      Perfil creado el {formatExactDateTime(profile.created_at)}
                    </p>
                  ) : null}
                </div>
              </div>
              {!profile ? (
                <div className="mt-5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
                  {auth.profileError ??
                    "Tu sesión está activa, pero falta completar el perfil."}{" "}
                  Completa username y siglas en Ajustes.
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {statCards.map((stat) => (
                <div
                  className="rounded-lg border p-4 theme-border theme-surface-muted"
                  key={stat.label}
                  title={stat.help}
                >
                  <p className="text-xs font-semibold uppercase theme-text-muted">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold theme-text">{stat.value}</p>
                  {stat.provisional ? (
                    <p className="mt-1 text-xs theme-text-muted">Provisional</p>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="font-semibold theme-text">Medallas</p>
              <p className="mt-2 text-sm theme-text-muted">
                Las medallas personalizadas aparecerán aquí­.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {["Campeón", "Primer podio", "Racha"].map((label) => (
                  <div
                    className="rounded-lg border p-4 opacity-60 theme-border theme-surface-muted"
                    key={label}
                    title="Medalla futura."
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold theme-surface-strong">
                      ?
                    </div>
                    <p className="mt-3 text-sm font-semibold theme-text">{label}</p>
                    <p className="mt-1 text-xs theme-text-muted">Próximamente</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {activeSection === "settings" ? (
          <>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="font-semibold theme-text">Tema visual</p>
              <div className="mt-3">
                <ThemeSelect />
              </div>
            </div>

            <div className="rounded-lg border p-5 theme-border theme-surface">
              <div className="mb-5 flex items-center gap-3">
                <ProfileAvatar profile={profile} size="small" />
                <div>
                  <p className="font-semibold theme-text">Perfil editable</p>
                  <p className="text-sm theme-text-muted">
                    Username, siglas, descripción y avatar público.
                  </p>
                </div>
              </div>
              <ProfileForm
                auth={{ ...auth, profile }}
                onProfileSaved={(nextProfile) => setProfile(nextProfile)}
              />
            </div>

            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-5 text-[var(--warning-text)]">
              <p className="font-semibold">Zona peligrosa</p>
              <p className="mt-1 text-sm">
                Acción de desarrollo para borrar cuentas de prueba. En producción
                deberí­a sustituirse por desactivación o anonimización.
              </p>
              <div className="mt-3">
                <DeleteAccountButton />
              </div>
            </div>

            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="font-semibold theme-text">Sesión</p>
              <p className="mt-1 text-sm theme-text-muted">
                Sesión activa con {auth.email}.
              </p>
              <div className="mt-4">
                <LogoutButton />
              </div>
            </div>
          </>
        ) : null}

        {activeSection === "history" ? (
          <>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <SubmissionsTable
                currentUserId={auth.status === "signed-in" ? auth.profile?.id : null}
                currentUserInitials={
                  auth.status === "signed-in"
                    ? auth.profile?.initials ?? auth.metadataInitials
                    : null
                }
                emptyDescription="Tus enví­os reales aparecerán aquí­ cuando existan."
                emptyTitle="Todaví­a no hay enví­os para este perfil."
                showDetectedAt
                showPlayer={false}
                showSource
                showWeek
                submissions={recentSubmissions}
                title="Historial de envíos"
              />
            </div>
            <div className="rounded-lg border p-5 theme-border theme-surface">
              <p className="mb-4 font-semibold theme-text">
                Mejores puntuaciones por semana
              </p>
              {bestScores.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {bestScores.map((score) => (
                    <div
                      className="rounded-lg border p-4 theme-border theme-surface-muted"
                      key={score.week.id}
                    >
                      <p className="text-sm font-semibold theme-text">
                        Semana {score.week.number}
                        {score.game ? ` · ${score.game.title}` : ""}
                      </p>
                      <p className="mt-2 text-2xl font-bold theme-text">
                        {formatScore(score.bestScore)}
                      </p>
                      <p
                        className="mt-1 text-sm theme-text-muted"
                        title={formatExactDateTime(score.latestAt)}
                      >
                        {score.uploads} enví­os válidos
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <PlaceholderSection
                  title="Sin mejores puntuaciones todaví­a"
                  description="Cuando tengas enví­os válidos, se resumirá aquí­ tu mejor puntuación por semana."
                />
              )}
            </div>
            <PlaceholderSection
              title="Participaciones recientes"
              description="Actividad por temporada, juegos favoritos y tiempo de juego quedan preparados para futuras métricas."
            />
          </>
        ) : null}

        {activeSection === "advanced" ? <AdminCenter data={adminCenter} /> : null}
      </section>
    </div>
  );
}
