export const authProfileUpdatedEvent = "hsl-auth-profile-updated";

export function notifyAuthProfileUpdated() {
  window.dispatchEvent(new Event(authProfileUpdatedEvent));
}
