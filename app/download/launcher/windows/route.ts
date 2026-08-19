import { getWindowsLauncherDownloadResponse } from "@/lib/launcher-download";

export const dynamic = "force-dynamic";

export async function GET() {
  return getWindowsLauncherDownloadResponse();
}
