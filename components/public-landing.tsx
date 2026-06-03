import Link from "next/link";

type PublicLandingProps = {
  hasHorizontalLogo: boolean;
};

export function PublicLanding({ hasHorizontalLogo }: PublicLandingProps) {
  return (
    <section className="mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center text-center">
      {hasHorizontalLogo ? (
        <img
          alt="High Score League"
          className="h-auto w-full max-w-md"
          src="/brand/logo-horizontal.png"
        />
      ) : (
        <div className="inline-flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-md text-base font-bold theme-surface-strong">
            HSL
          </span>
          <span className="text-2xl font-bold uppercase theme-text">
            High Score League
          </span>
        </div>
      )}

      <div className="mt-10 rounded-lg border p-8 shadow-panel theme-border theme-surface">
        <p className="text-xs font-semibold uppercase theme-text-muted">
          Liga privada
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight theme-text sm:text-5xl">
          Liga privada de puntuaciones arcade
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 theme-text-muted">
          Compite por semanas, sube puntuaciones desde MAME y sigue la
          clasificación de temporada.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-md bg-circuit px-5 py-3 text-sm font-semibold text-white"
            href="/login"
          >
            Iniciar sesión
          </Link>
          <Link
            className="rounded-md border px-5 py-3 text-sm font-semibold theme-border theme-surface-muted theme-text"
            href="/register"
          >
            Crear cuenta
          </Link>
        </div>
      </div>
    </section>
  );
}
