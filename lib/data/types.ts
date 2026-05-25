export type DataSource = "mock" | "supabase";

export type DataReadResult<T> = {
  rows: T[];
  source: DataSource;
  error: string | null;
  usingFallback: boolean;
};

export type DataReadOptions = {
  fallbackToMock?: boolean;
};
