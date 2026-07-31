import { Breadcrumbs } from "@/components/ui/breadcrumbs";
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
      <Breadcrumbs
        items={[{ label: "Jugadores" }, { label: `@${profile.username}` }]}
      />
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
