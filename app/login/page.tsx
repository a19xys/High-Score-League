import { LoginForm } from "@/components/auth/login-form";
import { Card, CardHeader } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | High Score League",
};

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader title="Iniciar sesión" eyebrow="Auth">
          Accede con email y contraseña. El mockup principal sigue funcionando
          aunque no hayas iniciado sesión.
        </CardHeader>
        <LoginForm />
      </Card>
    </div>
  );
}
