import Link from "next/link";
import type { PlayerCompetitiveProfile } from "@/lib/data/player-profile";
import { AdminProfileCenter } from "@/components/profile/admin-profile-center";
import { ProfileAccountSettings } from "@/components/profile/profile-account-settings";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { ProfileHero } from "@/components/profile/profile-hero";
import { ProfileStats } from "@/components/profile/profile-stats";
import { ProfileBestScoresTable } from "@/components/profile/profile-best-scores-table";
import { ProfileSubmissionsHistory } from "@/components/profile/profile-submissions-history";
import {
  ProfileSectionSwitcher,
  type ProfileSection,
} from "@/components/profile/profile-section-switcher";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type {
  AdminCenterData,
  ProfileAuthData,
} from "@/components/profile/profile-types";
import type { PlayerPlayTime } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";

export type { ProfileAuthData } from "@/components/profile/profile-types";
export type {
  PlayerBestScore as ProfileBestScore,
  PlayerProfileStats as ProfileStats,
} from "@/lib/data/player-profile";

type ProfileDashboardProps = {
  auth: ProfileAuthData;
  adminCenter: AdminCenterData;
  competitive: PlayerCompetitiveProfile;
  playTime: PlayerPlayTime;
  presence: PlayerPresence;
};

function ProfileAccessState({
  status,
}: {
  status: "not-configured" | "signed-out";
}) {
  const notConfigured = status === "not-configured";

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Mi perfil" }]} />
      <section className="profile-hero relative overflow-hidden rounded-[1.75rem] border border-white/10 p-6 text-white shadow-[0_28px_70px_rgba(2,6,23,0.24)] sm:p-10">
      <div aria-hidden="true" className="profile-hero-grid" />
      <div className="relative z-[1] max-w-2xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-cyan-200">
          Perfil de jugador
        </p>
        <h1 className="mt-3 text-3xl font-black text-white sm:text-5xl">
          {notConfigured
            ? "El perfil no está disponible"
            : "Entra para ver tu trayectoria"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-white/75 sm:text-base">
          {notConfigured
            ? "La conexión de datos necesaria para cargar perfiles no está configurada en este entorno."
            : "Tu identidad, resultados, mejores marcas y ajustes viven en un centro privado de la liga."}
        </p>
        {!notConfigured ? (
          <Link
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            href="/login"
          >
            Iniciar sesión
          </Link>
        ) : null}
      </div>
      </section>
    </div>
  );
}

function ProfileOnboarding({
  auth,
}: {
  auth: Extract<ProfileAuthData, { status: "signed-in" }>;
}) {
  const initials = auth.metadataInitials || "HSL";

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Mi perfil" }]} />
      <section className="profile-hero relative overflow-hidden rounded-[1.75rem] border border-white/10 p-6 text-white shadow-[0_28px_70px_rgba(2,6,23,0.24)] sm:p-9">
        <div aria-hidden="true" className="profile-hero-grid" />
        <div className="relative z-[1] flex flex-col gap-6 sm:flex-row sm:items-center">
          <ProfileAvatar
            initials={initials}
            size="large"
            username={auth.metadataUsername || "jugador"}
          />
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-cyan-200">
              Sesión activa · perfil incompleto
            </p>
            <h1 className="mt-2 text-3xl font-black text-white sm:text-5xl">
              Termina tu tarjeta de jugador
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">
              Solo faltan una identidad válida y tus preferencias. No has perdido la sesión y no mostraremos estadísticas vacías como si fueran contenido real.
            </p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <ProfileEditor auth={auth} onboarding />
        <ProfileAccountSettings email={auth.email} />
      </div>
    </div>
  );
}

export function ProfileDashboard({
  auth,
  adminCenter,
  competitive,
  playTime,
  presence,
}: ProfileDashboardProps) {
  if (auth.status === "not-configured" || auth.status === "signed-out") {
    return <ProfileAccessState status={auth.status} />;
  }

  if (!auth.profile) {
    return <ProfileOnboarding auth={auth} />;
  }

  const summaryPanel = (
    <div className="space-y-5">
      <ProfileHero mode="owner" profile={auth.profile} />
      <ProfileStats
        playTime={playTime}
        presence={presence}
        presenceOwner
        stats={competitive.stats}
        username={auth.profile.username}
      />
      {competitive.hasDataWarning ? (
        <div
          className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-text)]"
          role="status"
        >
          Parte del resumen competitivo no está disponible. Los datos verificados siguen visibles.
        </div>
      ) : null}
      <ProfileBestScoresTable scores={competitive.bestScores} />
    </div>
  );
  const sections: ProfileSection[] = [
    { id: "resumen", label: "Resumen", panel: summaryPanel },
    {
      id: "envios",
      label: "Envíos",
      panel: (
        <ProfileSubmissionsHistory
          playerId={auth.profile.id}
          playerInitials={auth.profile.initials}
          submissions={competitive.ownerSubmissions}
        />
      ),
    },
    {
      id: "editar",
      label: "Editar perfil",
      panel: <ProfileEditor auth={auth} />,
    },
    {
      id: "cuenta",
      label: "Cuenta",
      panel: (
        <ProfileAccountSettings
          email={auth.email}
          playerId={auth.profile.id}
          username={auth.profile.username}
        />
      ),
    },
  ];

  if (adminCenter.isAdmin) {
    sections.push({
      id: "administracion",
      label: "Administración",
      panel: <AdminProfileCenter data={adminCenter} />,
    });
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Mi perfil" }]} />
      <ProfileSectionSwitcher sections={sections} />
    </div>
  );
}
