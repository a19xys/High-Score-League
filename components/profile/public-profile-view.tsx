import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type {
  PlayerCompetitiveProfile,
  PublicPlayerProfile,
} from "@/lib/data/player-profile";
import { ProfileHero } from "./profile-hero";
import { ProfileStats } from "./profile-stats";
import { ProfileBestScoresTable } from "./profile-best-scores-table";
import type { PlayerPlayTime } from "@/lib/playtime";

type PublicProfileViewProps = {
  profile: PublicPlayerProfile;
  competitive: PlayerCompetitiveProfile;
  playTime: PlayerPlayTime;
};

export function PublicProfileView({
  profile,
  competitive,
  playTime,
}: PublicProfileViewProps) {
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: "Jugadores" }, { label: `@${profile.username}` }]}
      />
      <ProfileHero mode="public" profile={profile} />
      <ProfileStats playTime={playTime} stats={competitive.stats} />
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
}
