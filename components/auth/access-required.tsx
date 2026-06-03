import Link from "next/link";

type AccessRequiredProps = {
  title?: string;
  description?: string;
  showHomeLink?: boolean;
};

export function AccessRequired({
  title = "Esta sección pertenece a una liga privada.",
  description = "Inicia sesión o crea una cuenta para acceder a High Score League.",
  showHomeLink = true,
}: AccessRequiredProps) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border p-6 text-center shadow-panel theme-border theme-surface">
      <p className="text-xs font-semibold uppercase theme-text-muted">
        Acceso privado
      </p>
      <h1 className="mt-3 text-2xl font-bold theme-text">{title}</h1>
      <p className="mx-auto mt-3 max-w-xl leading-7 theme-text-muted">
        {description}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white"
          href="/login"
        >
          Iniciar sesión
        </Link>
        <Link
          className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-surface-muted theme-text"
          href="/register"
        >
          Crear cuenta
        </Link>
        {showHomeLink ? (
          <Link
            className="rounded-md px-4 py-3 text-sm font-semibold theme-hover theme-text-muted"
            href="/"
          >
            Volver a inicio
          </Link>
        ) : null}
      </div>
    </section>
  );
}
