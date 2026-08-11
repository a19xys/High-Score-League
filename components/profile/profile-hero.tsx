import { formatFullDate } from "@/lib/format";
import type { PublicPlayerProfile } from "@/lib/data/player-profile";
import { getProfileBioDisplay } from "@/lib/profile";
import type { RealProfile } from "@/types/supabase";
import { ProfileAvatar } from "./profile-avatar";

type ProfileHeroProps = {
  profile: RealProfile | PublicPlayerProfile;
  mode: "owner" | "public";
};

export function ProfileHero({ profile, mode }: ProfileHeroProps) {
  return (
    <section className="profile-hero relative overflow-hidden rounded-[1.75rem] border border-white/10 px-5 py-7 text-white shadow-[0_28px_70px_rgba(2,6,23,0.24)] sm:px-8 sm:py-9 lg:px-10">
      <div aria-hidden="true" className="profile-hero-grid" />
      <div className="relative z-[1] flex min-w-0 flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
        <ProfileAvatar
          avatarUrl={profile.avatar_url}
          glow
          initials={profile.initials}
          size="hero"
          username={profile.username}
        />

        <div className="w-full min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-200">
            {mode === "owner" ? "Tu tarjeta de jugador" : "Jugador de la liga"}
          </p>
          <h1 className="mt-2 break-words text-4xl font-black leading-none tracking-[-0.04em] text-white sm:text-6xl">
            {profile.initials}
          </h1>
          <p className="mt-2 break-words text-base font-semibold text-white/70 [overflow-wrap:anywhere] sm:text-lg">
            @{profile.username}
          </p>
          <p className="mt-5 max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-white/85 sm:text-base sm:leading-7">
            {getProfileBioDisplay(profile.bio)}
          </p>
          {profile.created_at ? (
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-white/55">
              En la liga desde el {formatFullDate(profile.created_at)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
