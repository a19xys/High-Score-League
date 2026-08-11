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
    <section className="rounded-2xl border p-4 shadow-panel theme-border theme-surface sm:p-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-circuit">
          Cuenta
        </p>
        <h2 className="mt-1 text-2xl font-black theme-text">Apariencia y sesión</h2>
        <p className="mt-2 text-sm leading-6 theme-text-muted">
          Gestiona esta sesión, el tema visual y la baja de tu cuenta desde un único lugar.
        </p>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-lg font-black theme-text">Tema visual</h3>
          <p className="mt-1 text-sm leading-6 theme-text-muted">
            Elige Claro, Oscuro o sigue el sistema.
          </p>
          <div className="mt-3">
            <ThemeSelect />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-black theme-text">Cuenta conectada</h3>
          <p className="mt-2 break-all text-sm theme-text-muted">{email}</p>
          <div className="mt-3">
            <LogoutButton />
          </div>
        </div>
      </div>

      {playerId && username ? (
        <div className="mt-6 border-t pt-6 theme-border">
          <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-[var(--warning-text)]">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] opacity-75">
              Zona de peligro
            </p>
            <h3 className="mt-1 text-lg font-black">Eliminar mi cuenta</h3>
            <p className="mt-2 text-sm leading-6">
              Retira de forma irreversible tu identidad y acceso. La historia competitiva y el contenido histórico permanecerán asociados a un actor anónimo.
            </p>
            <ProfileAccountAnonymization playerId={playerId} username={username} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
