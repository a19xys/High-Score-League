"use client";

import { MediaUpload } from "@/components/media-upload";
import type { MediaSelection } from "@/lib/media/types";

type ProfileAvatarEditorProps = {
  currentUrl: string;
  selection: MediaSelection;
  onChange: (value: MediaSelection) => void;
  initials: string;
  username: string;
  disabled?: boolean;
};

export function ProfileAvatarEditor({
  currentUrl,
  selection,
  onChange,
  initials,
  username,
  disabled,
}: ProfileAvatarEditorProps) {
  return (
    <MediaUpload
      currentUrl={currentUrl}
      description={`Avatar público de ${username || "jugador"}. Se procesa en el navegador y las siglas siguen siendo el fallback.`}
      disabled={disabled}
      fallbackText={initials || "HSL"}
      label="Avatar público"
      onChange={onChange}
      preset="avatar"
      selection={selection}
    />
  );
}
