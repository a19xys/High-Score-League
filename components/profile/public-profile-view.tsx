import Link from "next/link";
import type {
  PlayerCompetitiveProfile,
  PublicPlayerProfile,
} from "@/lib/data/player-profile";
import { ProfileHero } from "./profile-hero";
import { ProfileHistory } from "./profile-history";
import { ProfileStats } from "./profile-stats";

type PublicProfileViewProps = {
  profile: PublicPlayerProfile;
  competitive: PlayerCompetitiveProfile;
};

export function PublicProfileView({
  profile,
  competitive,
}: PublicProfileViewProps) {
  return (
    <div className="space-y-6">
      <nav aria-label="Ruta de navegación" className="text-sm theme-text-muted">
        <Link
          className="rounded font-bold transition hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
          href="/archive?section=seasons"
        >
          Liga
        </Link>
        <span aria-hidden="true" className="mx-2 opacity-50">
          /
        </span>
        <span aria-current="page">@{profile.username}</span>
      </nav>
      <ProfileHero mode="public" profile={profile} />
      <ProfileStats stats={competitive.stats} />
      <ProfileHistory
        data={competitive}
        mode="public"
        playerId={profile.id}
        playerInitials={profile.initials}
      />
    </div>
  );
}
