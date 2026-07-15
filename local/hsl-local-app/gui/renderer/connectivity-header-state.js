export function deriveConnectivityHeaderState(connectivity = {}) {
  if (connectivity.reachability === "connected") return "connected";
  if (connectivity.reachability === "offline") return "offline";
  return "hidden";
}
