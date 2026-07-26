"use client";

import { ProfileAvatar } from "./profile-avatar";

type ProfileAvatarEditorProps = {
  value: string;
  onChange: (value: string) => void;
  initials: string;
  username: string;
};

export function ProfileAvatarEditor({
  value,
  onChange,
  initials,
  username,
}: ProfileAvatarEditorProps) {
  return (
    <div className="rounded-2xl border p-4 theme-border theme-surface-muted">
      <div className="flex items-center gap-4">
        <ProfileAvatar
          avatarUrl={value.trim() || null}
          initials={initials || "HSL"}
          size="medium"
          username={username || "jugador"}
        />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold theme-text">Avatar público</p>
          <p className="mt-1 text-xs leading-5 theme-text-muted">
            Se mantiene la imagen actual o el fallback de siglas.
          </p>
        </div>
      </div>

      <details className="group mt-4 border-t pt-4 theme-border">
        <summary className="w-fit cursor-pointer rounded-lg text-sm font-extrabold text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit">
          Cambiar imagen mediante URL
        </summary>
        <label className="mt-4 block">
          <span className="text-sm font-bold theme-text">URL de la imagen</span>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2.5 theme-input"
            inputMode="url"
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://ejemplo.com/avatar.jpg"
            type="url"
            value={value}
          />
          <span className="mt-2 block text-xs leading-5 theme-text-muted">
            Compatibilidad temporal con avatares existentes. Una URL vacía recupera el fallback de siglas.
          </span>
        </label>
      </details>
    </div>
  );
}
