import { LogoutButton } from "@/components/auth/logout-button";
import { ThemeSelect } from "@/components/theme-select";
import { ProfileAccountAnonymization } from "./profile-account-anonymization";

type ProfileAccountSettingsProps = {
  email: string;
  playerId?: string;
  username?: string;
};

export function ProfileAccountSettings({
  email,
  playerId,
  username,
}: ProfileAccountSettingsProps) {
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

      {playerId && username ? (
        <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-[var(--warning-text)] sm:p-6">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] opacity-75">
            Zona de peligro
          </p>
          <h2 className="mt-1 text-lg font-black">Eliminar mi cuenta</h2>
          <p className="mt-2 text-sm leading-6">
            Retira de forma irreversible tu identidad y acceso. La historia competitiva y el contenido histórico permanecerán asociados a un actor anónimo.
          </p>
          <ProfileAccountAnonymization playerId={playerId} username={username} />
        </div>
      ) : null}
    </section>
  );
}
