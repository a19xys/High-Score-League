import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardHeader } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registro | High Score League",
};

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader title="Crear cuenta" eyebrow="Auth">
          Registro mínimo con Supabase Auth. Después podrás completar username y
          siglas en el perfil real.
        </CardHeader>
        <RegisterForm />
      </Card>
    </div>
  );
}
