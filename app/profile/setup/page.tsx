import { ProfileSetupForm } from "@/components/auth/profile-setup-form";
import { Card, CardHeader } from "@/components/ui/card";

export default function ProfileSetupPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader title="Completar perfil" eyebrow="Perfil real">
          Crea o actualiza tu username y tus siglas. No se puede activar admin
          desde la aplicación.
        </CardHeader>
        <ProfileSetupForm />
      </Card>
    </div>
  );
}
