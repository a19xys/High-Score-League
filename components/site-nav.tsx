import { existsSync } from "node:fs";
import { join } from "node:path";
import { getServerSession } from "@/lib/auth/session";
import { getRealSeasons } from "@/lib/data/seasons";
import { getRealWeeks } from "@/lib/data/weeks";
import { getSynchronizedSeasonStatus, getSynchronizedWeekStatus } from "@/lib/week-status";
import { SiteNavClient, type SiteNavData } from "./site-nav-client";

async function getSupabaseNavData(): Promise<SiteNavData> {
  const [weeksResult, seasonsResult] = await Promise.all([
    getRealWeeks(),
    getRealSeasons(),
  ]);
  const now = new Date();
  const activeWeek =
    weeksResult.error
      ? null
      : weeksResult.rows
          .filter((week) => {
            const status = getSynchronizedWeekStatus(week, now);
            return status === "active" || status === "frozen";
          })
          .sort((a, b) => {
            const dateOrder = (a.public_start_at ?? "").localeCompare(
              b.public_start_at ?? "",
            );
            return dateOrder || a.week_number - b.week_number;
          })[0] ?? null;
  const activeSeason =
    seasonsResult.error
      ? null
      : seasonsResult.rows
          .filter((season) => getSynchronizedSeasonStatus(season, now) === "active")
          .sort((a, b) => {
            const dateOrder = (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
            return dateOrder || a.name.localeCompare(b.name);
          })[0] ?? null;

  return {
    activeWeekId: activeWeek?.id ?? null,
    activeSeasonId: activeSeason?.id ?? null,
    activeSeasonSlug: activeSeason?.slug ?? null,
    hasBrandLogo: hasStaticBrandLogo(),
    isSignedIn: true,
  };
}

function getSignedOutNavData(): SiteNavData {
  return {
    activeWeekId: null,
    activeSeasonId: null,
    activeSeasonSlug: null,
    hasBrandLogo: hasStaticBrandLogo(),
    isSignedIn: false,
  };
}

function hasStaticBrandLogo() {
  return existsSync(join(process.cwd(), "public", "brand", "logo.png"));
}

export async function SiteNav() {
  const session = await getServerSession();

  if (session.status !== "signed-in") {
    return <SiteNavClient data={getSignedOutNavData()} />;
  }

  return <SiteNavClient data={await getSupabaseNavData()} />;
}
