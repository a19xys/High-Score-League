import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRequired } from "@/components/auth/access-required";
import { PublicProfileView } from "@/components/profile/public-profile-view";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { hasServerSession } from "@/lib/auth/session";
import { usernamePattern } from "@/lib/auth/validation";
import {
  getPlayerCompetitiveProfile,
  getPublicPlayerProfile,
} from "@/lib/data/player-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPlayerPlayTime } from "@/lib/data/player-playtime";
import { getPlayerPresence } from "@/lib/data/player-presence";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Jugador | High Score League",
};

type PlayerPageProps = {
  params: Promise<{
    username: string;
  }>;
};

function ProfileUnavailable() {
  return (
    <Card>
      <CardHeader title="Perfil no disponible" eyebrow="Jugador">
        No se pudo completar una lectura segura del perfil público.
      </CardHeader>
      <EmptyState
        title="Inténtalo de nuevo más tarde."
        description="La liga no expondrá detalles técnicos ni datos parciales que no haya podido verificar."
      />
    </Card>
  );
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const { username } = await params;

  if (!usernamePattern.test(username)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <ProfileUnavailable />;
  }

  const profileResult = await getPublicPlayerProfile(supabase, username);

  if (profileResult.status === "error") {
    return <ProfileUnavailable />;
  }

  if (profileResult.status === "not-found") {
    notFound();
  }

  const { data: visitor } = await supabase.auth.getUser();
  const isOwner = visitor.user?.id === profileResult.profile.id;
  const [competitive, playTime, presence] = await Promise.all([
    getPlayerCompetitiveProfile(profileResult.profile.id, "public"),
    getPlayerPlayTime(supabase, profileResult.profile.id, {
      isOwner,
      playTimePublic: profileResult.profile.play_time_public === true,
    }),
    getPlayerPresence(profileResult.profile.id),
  ]);

  return (
    <PublicProfileView
      competitive={competitive}
      playTime={playTime}
      presence={presence}
      profile={profileResult.profile}
    />
  );
}
