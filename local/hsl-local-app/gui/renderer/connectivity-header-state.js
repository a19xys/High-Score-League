import { deriveRemoteAvailability } from "./remote-availability.js";

export function deriveConnectivityHeaderState(connectivity) {
  const remote = deriveRemoteAvailability(connectivity);
  if (remote.status === "connected") return "connected";
  if (remote.status === "offline") return "offline";
  return "hidden";
}
