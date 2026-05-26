import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WeekBenchmark } from "@/types";
import type { WeekBenchmarkRow } from "@/types/supabase";
import type { DataReadResult } from "./types";

const benchmarkColumns =
  "id,week_id,label,score,description,sort_order,is_active,created_at,updated_at";

export async function getRealWeekBenchmarks(
  weekId: string,
): Promise<DataReadResult<WeekBenchmarkRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      rows: [],
      source: "supabase",
      error: "Supabase no esta configurado.",
      usingFallback: false,
    };
  }

  const { data, error } = await supabase
    .from("week_benchmarks")
    .select(benchmarkColumns)
    .eq("week_id", weekId)
    .eq("is_active", true)
    .order("score", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    return {
      rows: [],
      source: "supabase",
      error: error.message,
      usingFallback: false,
    };
  }

  return {
    rows: (data ?? []) as WeekBenchmarkRow[],
    source: "supabase",
    error: null,
    usingFallback: false,
  };
}

export function mapWeekBenchmarkRowToBenchmark(
  row: WeekBenchmarkRow,
): WeekBenchmark {
  return {
    id: row.id,
    weekId: row.week_id,
    label: row.label,
    score: row.score,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}
