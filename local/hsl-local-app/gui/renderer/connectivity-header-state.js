import { derivePublicConnectivityPresentation } from "./product-presentation.js";

export function deriveConnectivityHeaderState(connectivity, remoteConfiguration = null) {
  return derivePublicConnectivityPresentation(connectivity, remoteConfiguration).status;
}
