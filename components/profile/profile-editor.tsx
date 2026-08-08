"use client";

import { type ClipboardEvent, type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  humanizeSupabaseError,
  normalizeInitials,
  PROFILE_BIO_MAX_LENGTH,
  validateInitials,
  validateProfileBio,
  validateUsername,
} from "@/lib/auth/validation";
import { invalidatePlayerProfilePreview } from "@/lib/player-profile-preview-cache";
import { executeMediaSave } from "@/lib/media/lifecycle";
import {
  UNCHANGED_MEDIA_SELECTION,
  type MediaSelection,
} from "@/lib/media/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealProfile } from "@/types/supabase";
import type { ProfileAuthData } from "./profile-types";
import { ProfileAvatarEditor } from "./profile-avatar-editor";

type SignedInProfileAuth = Extract<ProfileAuthData, { status: "signed-in" }>;

type ProfileEditorProps = {
  auth: SignedInProfileAuth;
  onboarding?: boolean;
};

export function ProfileEditor({ auth, onboarding = false }: ProfileEditorProps) {
  const router = useRouter();
  const [username, setUsername] = useState(
    auth.profile?.username ?? auth.metadataUsername,
  );
  const [initials, setInitials] = useState(
    auth.profile?.initials ?? auth.metadataInitials,
  );
  const [bio, setBio] = useState(auth.profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(auth.profile?.avatar_url ?? "");
  const [avatarStoragePath, setAvatarStoragePath] = useState(
    auth.profile?.avatar_storage_path ?? null,
  );
  const [avatarSelection, setAvatarSelection] = useState<MediaSelection>(
    UNCHANGED_MEDIA_SELECTION,
  );
  const [trackPlayTime, setTrackPlayTime] = useState(
    auth.profile?.track_play_time ?? true,
  );
  const [error, setError] = useState<string | null>(auth.profileError);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleBioPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    const selectionLength =
      event.currentTarget.selectionEnd - event.currentTarget.selectionStart;
    const nextLength = bio.length - selectionLength + pastedText.length;

    if (nextLength > PROFILE_BIO_MAX_LENGTH) {
      event.preventDefault();
      setError(
        `La bio no puede superar los ${PROFILE_BIO_MAX_LENGTH} caracteres. No se ha pegado el texto.`,
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const cleanUsername = username.trim();
    const cleanInitials = normalizeInitials(initials);
    const cleanBio = bio.trim();
    const usernameError = validateUsername(cleanUsername);
    const initialsError = validateInitials(cleanInitials);
    const bioError = validateProfileBio(cleanBio);

    if (usernameError || initialsError || bioError) {
      setError(usernameError ?? initialsError ?? bioError);
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setError("El perfil no está disponible en este entorno.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setError("La sesión ha caducado. Vuelve a iniciar sesión.");
      return;
    }

    setIsSubmitting(true);
    let profile: RealProfile;
    try {
      const saved = await executeMediaSave({
        supabase,
        changes: [
          {
            key: "avatar",
            selection: avatarSelection,
            currentStoragePath: avatarStoragePath,
            currentUrl: avatarUrl,
            userId: userData.user.id,
          },
        ],
        persist: async ([avatar]) => {
          const payload = {
            username: cleanUsername,
            initials: cleanInitials,
            bio: cleanBio || null,
            avatar_url: avatar.publicUrl,
            avatar_storage_path: avatar.storagePath,
            track_play_time: trackPlayTime,
          };
          const response = auth.profile
            ? await supabase
                .from("profiles")
                .update(payload)
                .eq("id", userData.user.id)
                .select(
                  "id,username,initials,avatar_url,avatar_storage_path,bio,track_play_time,is_admin,created_at,updated_at",
                )
                .single()
            : await supabase
                .from("profiles")
                .insert({ id: userData.user.id, ...payload })
                .select(
                  "id,username,initials,avatar_url,avatar_storage_path,bio,track_play_time,is_admin,created_at,updated_at",
                )
                .single();

          if (response.error) throw new Error(response.error.message);
          return response.data as RealProfile;
        },
      });
      profile = saved.result;
      if (saved.cleanupWarning) {
        setMessage(
          `Perfil guardado. No se pudo retirar la imagen anterior: ${saved.cleanupWarning}`,
        );
      }
    } catch (caught) {
      setError(
        humanizeSupabaseError(
          caught instanceof Error ? caught.message : "No se pudo guardar el perfil.",
        ),
      );
      setIsSubmitting(false);
      return;
    }
    invalidatePlayerProfilePreview({
      playerId: userData.user.id,
      usernames: [
        auth.profile?.username,
        auth.metadataUsername,
        profile.username,
      ],
    });
    const metadataUpdate = await supabase.auth.updateUser({
      data: {
        username: profile.username,
        initials: profile.initials,
      },
    });

    if (metadataUpdate.error) {
      setError(humanizeSupabaseError(metadataUpdate.error.message));
      setIsSubmitting(false);
      return;
    }

    setUsername(profile.username);
    setInitials(profile.initials);
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? "");
    setAvatarStoragePath(profile.avatar_storage_path ?? null);
    setAvatarSelection(UNCHANGED_MEDIA_SELECTION);
    setTrackPlayTime(profile.track_play_time ?? true);
    setMessage((current) => current ?? "Perfil guardado correctamente.");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <section
      className="scroll-mt-32 rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6"
      id="editar-perfil"
    >
      <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-circuit">
        {onboarding ? "Paso esencial" : "Identidad"}
      </p>
      <h2 className="mt-1 text-2xl font-black theme-text">
        {onboarding ? "Completa tu tarjeta" : "Editar perfil"}
      </h2>
      <p className="mt-2 text-sm leading-6 theme-text-muted">
        {onboarding
          ? "Elige una identidad válida para entrar en la liga sin perder tu sesión."
          : "Estos datos forman tu identidad visible dentro de la liga."}
      </p>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold theme-text">Username</span>
            <input
              autoComplete="username"
              className="mt-2 w-full rounded-xl border px-3 py-2.5 theme-input"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="lauravc"
              required
              value={username}
            />
            <span className="mt-2 block text-xs leading-5 theme-text-muted">
              3–20 caracteres; empieza por letra y usa minúsculas, números o guion bajo.
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-bold theme-text">Siglas</span>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2.5 uppercase theme-input"
              maxLength={3}
              onChange={(event) =>
                setInitials(normalizeInitials(event.target.value))
              }
              placeholder="LVC"
              required
              spellCheck={false}
              value={initials}
            />
            <span className="mt-2 block text-xs leading-5 theme-text-muted">
              Exactamente 3 letras o números. Se guardan en mayúsculas.
            </span>
          </label>
        </div>

        <label className="block" htmlFor="profile-bio">
          <span className="text-sm font-bold theme-text">Bio pública</span>
          <textarea
            aria-describedby="profile-bio-help profile-bio-count"
            className="mt-2 min-h-32 w-full resize-y rounded-xl border px-3 py-2.5 theme-input"
            id="profile-bio"
            maxLength={PROFILE_BIO_MAX_LENGTH}
            onChange={(event) => setBio(event.target.value)}
            onPaste={handleBioPaste}
            placeholder="Cuéntale a los demás sobre ti…"
            value={bio}
          />
          <span className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs leading-5 theme-text-muted">
            <span id="profile-bio-help">
              Máximo {PROFILE_BIO_MAX_LENGTH} caracteres. Es opcional y aparecerá en tu perfil público.
            </span>
            <span className="shrink-0 tabular-nums" id="profile-bio-count">
              {bio.length} / {PROFILE_BIO_MAX_LENGTH}
            </span>
          </span>
        </label>

        <ProfileAvatarEditor
          currentUrl={avatarUrl}
          disabled={isSubmitting}
          initials={normalizeInitials(initials)}
          onChange={setAvatarSelection}
          selection={avatarSelection}
          username={username.trim()}
        />

        <label className="flex items-start gap-3 rounded-2xl border p-4 theme-border theme-surface-muted">
          <input
            checked={trackPlayTime}
            className="mt-1 h-4 w-4 accent-circuit"
            onChange={(event) => setTrackPlayTime(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block font-extrabold theme-text">
              Permitir registrar mi tiempo de juego
            </span>
            <span className="mt-1 block text-xs leading-5 theme-text-muted">
              Es un permiso de recopilación para la app local. No hace público tu tiempo, tu presencia ni tu última actividad.
            </span>
          </span>
        </label>

        <div aria-live="polite" className="min-h-5">
          {error ? (
            <p
              className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="text-sm font-semibold text-emerald-600" role="status">
              {message}
            </p>
          ) : null}
        </div>

        <button
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-circuit px-5 py-3 text-sm font-extrabold text-slate-950 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? "Guardando…"
            : onboarding
              ? "Crear mi perfil"
              : "Guardar cambios"}
        </button>
      </form>
    </section>
  );
}
