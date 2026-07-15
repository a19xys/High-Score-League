export function deriveConnectivityHeaderState(connectivity) {
  const reachability = connectivity?.reachability;

  if (reachability === "connected") return "connected";
  if (reachability === "offline") return "offline";
  return "hidden";
}
