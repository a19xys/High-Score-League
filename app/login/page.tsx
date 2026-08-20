import { LoginForm } from "@/components/auth/login-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | High Score League",
};

type LoginPageProps = {
  searchParams: Promise<{ passwordReset?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { passwordReset } = await searchParams;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Iniciar sesión" }]} />
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader title="Iniciar sesión" eyebrow="Auth">
            Accede con email y contraseña para entrar en la liga privada.
          </CardHeader>
          <LoginForm passwordResetSucceeded={passwordReset === "success"} />
        </Card>
      </div>
    </div>
  );
}
