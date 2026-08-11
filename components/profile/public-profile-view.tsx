import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type {
  PlayerCompetitiveProfile,
  PublicPlayerProfile,
} from "@/lib/data/player-profile";
import { ProfileHero } from "./profile-hero";
import { ProfileStats } from "./profile-stats";
import { ProfileBestScoresTable } from "./profile-best-scores-table";
import type { PlayerPlayTime } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";

type PublicProfileViewProps = {
  profile: PublicPlayerProfile;
  competitive: PlayerCompetitiveProfile;
  playTime: PlayerPlayTime;
  presence: PlayerPresence;
  presenceOwner: boolean;
};

export function PublicProfileView({
  profile,
  competitive,
  playTime,
  presence,
  presenceOwner,
}: PublicProfileViewProps) {
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: "Jugadores" }, { label: `@${profile.username}` }]}
      />
      <ProfileHero mode="public" profile={profile} />
      <ProfileStats
        playTime={playTime}
        presence={presence}
        presenceOwner={presenceOwner}
        stats={competitive.stats}
        username={profile.username}
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
}
