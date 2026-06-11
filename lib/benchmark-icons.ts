export const BENCHMARK_ICON_KEYS = [
  "speedometer_1",
  "speedometer_2",
  "speedometer_3",
] as const;

export type BenchmarkIconKey = (typeof BENCHMARK_ICON_KEYS)[number];

export const DEFAULT_BENCHMARK_ICON_KEY: BenchmarkIconKey = "speedometer_3";

export const BENCHMARK_ICON_LABELS: Record<BenchmarkIconKey, string> = {
  speedometer_1: "Fácil",
  speedometer_2: "Medio",
  speedometer_3: "Difícil",
};

export function isBenchmarkIconKey(value: unknown): value is BenchmarkIconKey {
  return (
    typeof value === "string" &&
    BENCHMARK_ICON_KEYS.includes(value as BenchmarkIconKey)
  );
}

export function normalizeBenchmarkIconKey(
  value: unknown,
): BenchmarkIconKey | null {
  return isBenchmarkIconKey(value) ? value : null;
}

export function getBenchmarkIconSrc(value?: string | null) {
  const iconKey = normalizeBenchmarkIconKey(value) ?? DEFAULT_BENCHMARK_ICON_KEY;
  return `/icons/${iconKey}.png`;
}
