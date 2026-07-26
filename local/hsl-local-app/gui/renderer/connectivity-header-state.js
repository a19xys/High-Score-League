import { deriveConnectivityPresentation } from "./product-presentation.js";

export function deriveConnectivityHeaderState(connectivity) {
  return deriveConnectivityPresentation(connectivity).status;
}
