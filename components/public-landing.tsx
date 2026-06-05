import Link from "next/link";

type PublicLandingProps = {
  hasHorizontalLogo: boolean;
};

export function PublicLanding({ hasHorizontalLogo }: PublicLandingProps) {
  return (
    <section className="public-landing-shell">
      <div aria-hidden="true" className="public-landing-aurora" />
      <div className="public-landing-content">
        {hasHorizontalLogo ? (
          <img
            alt="High Score League"
            className="public-landing-logo mx-auto h-auto max-h-[28vh] w-auto max-w-[22rem] object-contain sm:max-w-lg"
            src="/brand/logo-horizontal.png"
          />
        ) : (
          <div className="inline-flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-md bg-white/10 text-base font-bold text-white ring-1 ring-white/15">
              HSL
            </span>
            <span className="text-2xl font-bold uppercase text-white">
              High Score League
            </span>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-white/15 bg-slate-950/70 p-6 text-white shadow-panel backdrop-blur-sm sm:p-8">
          <p className="text-xs font-semibold uppercase text-cyan-100/80">
            Liga privada
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-white sm:text-5xl">
            Liga privada de puntuaciones arcade
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-200">
            Compite por semanas, sube puntuaciones desde MAME y sigue la
            clasificación de temporada.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              className="rounded-md bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
              href="/login"
            >
              Iniciar sesión
            </Link>
            <Link
              className="rounded-md border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
              href="/register"
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
