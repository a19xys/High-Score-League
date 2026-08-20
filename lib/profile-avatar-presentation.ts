export function getProfileAvatarPresentation(
  avatarUrl: string | null | undefined,
  failedAvatarUrl: string | null,
) {
  const showImage = Boolean(avatarUrl && avatarUrl !== failedAvatarUrl);

  return {
    showImage,
    showInitials: !showImage,
  };
}
