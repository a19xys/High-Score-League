export type DataSource = "supabase";

export type DataReadResult<T> = {
  rows: T[];
  source: DataSource;
  error: string | null;
};

export type DataReadOptions = Record<string, never>;

