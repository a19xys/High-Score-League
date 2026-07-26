import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { PublicPlayerProfile } from "@/lib/data/player-profile";
import type { RealProfile } from "@/types/supabase";
import { ProfileAvatar } from "./profile-avatar";

type ProfileHeroProps = {
  profile: RealProfile | PublicPlayerProfile;
  mode: "owner" | "public";
};

export function ProfileHero({ profile, mode }: ProfileHeroProps) {
  return (
    <section
      className="profile-hero relative scroll-mt-32 overflow-hidden rounded-[1.75rem] border border-white/10 px-5 py-7 text-white shadow-[0_28px_70px_rgba(2,6,23,0.24)] sm:px-8 sm:py-9 lg:px-10"
      id="resumen"
    >
      <div aria-hidden="true" className="profile-hero-grid" />
      <div className="relative z-[1] grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-8">
        <ProfileAvatar
          avatarUrl={profile.avatar_url}
          initials={profile.initials}
          size="hero"
          username={profile.username}
        />

        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-200">
            {mode === "owner" ? "Tu tarjeta de jugador" : "Jugador de la liga"}
          </p>
          <h1 className="mt-2 break-words text-5xl font-black leading-none tracking-[-0.05em] text-white sm:text-6xl">
            {profile.initials}
          </h1>
          <p className="mt-2 break-all text-base font-semibold text-white/70 sm:text-lg">
            @{profile.username}
          </p>
          <p className="mt-5 max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-white/85 sm:text-base sm:leading-7">
            {profile.bio?.trim() ||
              (mode === "owner"
                ? "Añade una bio para contarle a la liga cómo juegas."
                : "Este jugador todavía no ha añadido una bio pública.")}
          </p>
          {profile.created_at ? (
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-white/55">
              En la liga desde {formatDate(profile.created_at)}
            </p>
          ) : null}
        </div>

        {mode === "owner" ? (
          <div className="flex flex-row flex-wrap gap-2 md:w-44 md:flex-col">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              href="#editar-perfil"
            >
              Editar identidad
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 bg-white/5 px-4 py-2 text-center text-sm font-bold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              href={`/players/${encodeURIComponent(profile.username)}`}
            >
              Ver perfil público
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
