import { getLauncherDeploymentHeaders } from "../../../../lib/launcher-deployment.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...getLauncherDeploymentHeaders(),
    },
  });
}
