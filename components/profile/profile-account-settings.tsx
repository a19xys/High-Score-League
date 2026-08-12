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

      <div className="mt-6 space-y-6">
        <div>
          <h3 className="text-lg font-black theme-text">Tema visual</h3>
          <p className="mt-1 text-sm leading-6 theme-text-muted">
            Elige Claro, Oscuro o sigue el sistema.
          </p>
          <div className="mt-3">
            <ThemeSelect />
          </div>
        </div>

        <div className="border-t pt-6 theme-border">
          <h3 className="text-lg font-black theme-text">Sesión</h3>
          <p className="mt-2 text-sm leading-6 theme-text-muted">
            Sesión iniciada con la cuenta:{" "}
            <span className="break-all font-semibold theme-text">{email}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <LogoutButton />
            {playerId && username ? (
              <ProfileAccountAnonymization playerId={playerId} username={username} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
