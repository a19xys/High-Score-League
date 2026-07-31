import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registro | High Score League",
};

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Crear cuenta" }]} />
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader title="Crear cuenta" eyebrow="Registro">
            Crea tu cuenta de jugador con email, username y siglas para competir
            en la liga.
          </CardHeader>
          <RegisterForm />
        </Card>
      </div>
    </div>
  );
}
