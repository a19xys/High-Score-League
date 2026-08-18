import {
  deriveCanonicalWeekAuthority,
  type CanonicalWeekPublicState,
  type DerivedWeekStatus,
} from "./week-status.ts";

export type CurrentCompetitionPublicState = CanonicalWeekPublicState;
export type CurrentCompetitionDerivedStatus = DerivedWeekStatus;

type CurrentCompetitionWeek = {
  status: string;
  public_start_at?: string | null;
  public_freeze_at?: string | null;
  final_deadline_at?: string | null;
};

type CurrentCompetitionSeason = {
  status: string;
};

export function deriveCurrentCompetitionWeekState(options: {
  week: CurrentCompetitionWeek;
  season: CurrentCompetitionSeason;
  hasOfficialResults?: boolean;
  now?: Date;
}) {
  return deriveCanonicalWeekAuthority(options);
}
