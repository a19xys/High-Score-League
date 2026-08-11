"use client";

import { MediaUpload } from "@/components/media-upload";
import type { MediaSelection } from "@/lib/media/types";

type ProfileAvatarEditorProps = {
  currentUrl: string;
  selection: MediaSelection;
  onChange: (value: MediaSelection) => void;
  initials: string;
  disabled?: boolean;
};

export function ProfileAvatarEditor({
  currentUrl,
  selection,
  onChange,
  initials,
  disabled,
}: ProfileAvatarEditorProps) {
  return (
    <MediaUpload
      currentUrl={currentUrl}
      description="JPEG, PNG o WebP · máximo 12 MB"
      disabled={disabled}
      fallbackText={initials || "HSL"}
      label="Avatar público"
      onChange={onChange}
      preset="avatar"
      selection={selection}
    />
  );
}
