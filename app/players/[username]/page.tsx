import { notFound } from "next/navigation";
import { AccessRequired } from "@/components/auth/access-required";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state";
import { hasServerSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RealProfile } from "@/types/supabase";

type PlayerPageProps = {
  params: Promise<{
    username: string;
  }>;
};

async function getProfile(username: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { profile: null, error: "Supabase no está configurado." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,initials,avatar_url,bio,track_play_time,is_admin,created_at,updated_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return { profile: null, error: error.message };
  }

  return { profile: (data ?? null) as RealProfile | null, error: null };
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  const { username } = await params;
  const { profile, error } = await getProfile(username);

  if (error) {
    return (
      <Card>
        <CardHeader title="Perfil no disponible" eyebrow="Jugador">
          No se pudo cargar el perfil público.
        </CardHeader>
        <EmptyState title="Error de lectura." description={error} />
      </Card>
    );
  }

  if (!profile) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader eyebrow="Perfil público" title={profile.initials}>
          @{profile.username}
        </CardHeader>
        <div className="mb-5 flex flex-wrap items-start gap-5">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full text-2xl font-bold theme-surface-strong">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`Avatar de ${profile.username}`}
                className="h-full w-full object-cover"
                src={profile.avatar_url}
              />
            ) : (
              profile.initials
            )}
          </div>
          <div className="max-w-2xl">
            <p className="text-3xl font-bold theme-text">{profile.initials}</p>
            <p className="theme-text-muted">@{profile.username}</p>
            <p className="mt-4 leading-7 theme-text">
              {profile.bio ?? "Este jugador todavía no ha añadido una bio pública."}
            </p>
          </div>
        </div>
      </Card>

      <EmptyState
        title="Historial público pendiente."
        description="Los mejores resultados públicos se conectarán desde submissions y weekly_results en una fase posterior."
      />
    </div>
  );
}
