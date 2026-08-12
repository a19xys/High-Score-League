import Link from "next/link";
import { BrandImage } from "@/components/brand-image";

export function PublicLanding() {
  return (
    <section className="public-landing-shell">
      <div aria-hidden="true" className="public-landing-aurora" />
      <div className="public-landing-content">
        <BrandImage
          alt="High Score League"
          className="public-landing-logo mx-auto h-auto max-h-[28vh] w-auto max-w-[22rem] object-contain sm:max-w-lg"
          fallback={
            <div className="public-landing-logo public-landing-logo-fallback inline-flex items-center gap-3">
              <span className="public-landing-logo-mark flex h-14 w-14 items-center justify-center rounded-md text-base font-bold">
                HSL
              </span>
              <span className="text-2xl font-bold uppercase">
                High Score League
              </span>
            </div>
          }
          src="/brand/logo-horizontal.png"
        />

        <div className="public-landing-card mt-6 rounded-lg border p-6 backdrop-blur-sm sm:p-8">
          <p className="public-landing-eyebrow text-xs font-semibold uppercase">
            Liga privada
          </p>
          <h1 className="public-landing-title mt-3 text-4xl font-bold leading-tight sm:text-5xl">
            Liga privada de puntuaciones arcade
          </h1>
          <p className="public-landing-body mx-auto mt-5 max-w-2xl text-base leading-7">
            Compite por semanas, sube puntuaciones desde MAME y sigue la
            clasificación de temporada.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              className="public-landing-primary-action rounded-md px-5 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
              href="/login"
            >
              Iniciar sesión
            </Link>
            <Link
              className="public-landing-secondary-action rounded-md border px-5 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
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
