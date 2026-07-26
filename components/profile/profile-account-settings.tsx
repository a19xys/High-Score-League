import { LogoutButton } from "@/components/auth/logout-button";
import { ThemeSelect } from "@/components/theme-select";

type ProfileAccountSettingsProps = {
  email: string;
};

export function ProfileAccountSettings({ email }: ProfileAccountSettingsProps) {
  return (
    <section className="scroll-mt-32 space-y-4" id="cuenta">
      <div className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-circuit">
          Apariencia
        </p>
        <h2 className="mt-1 text-xl font-black theme-text">Tema visual</h2>
        <p className="mt-2 text-sm leading-6 theme-text-muted">
          Elige Claro, Oscuro o deja que la app siga el sistema.
        </p>
        <div className="mt-4">
          <ThemeSelect />
        </div>
      </div>

      <div className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] theme-text-muted">
          Sesión
        </p>
        <h2 className="mt-1 text-xl font-black theme-text">Cuenta conectada</h2>
        <p className="mt-2 break-all text-sm theme-text-muted">{email}</p>
        <div className="mt-4">
          <LogoutButton />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-[var(--warning-text)] sm:p-6">
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] opacity-75">
          Conservación de historial
        </p>
        <h2 className="mt-1 text-lg font-black">Gestión futura de la cuenta</h2>
        <p className="mt-2 text-sm leading-6">
          La baja de una cuenta se diseñará como anonimización: retirará la identidad personal sin borrar resultados ni alterar la historia de la liga. No hay ninguna acción destructiva activa en esta pantalla.
        </p>
      </div>
    </section>
  );
}
