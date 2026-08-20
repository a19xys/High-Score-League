import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardHeader } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Recuperar contraseña | High Score League",
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Recuperar contraseña" }]} />
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader title="Recuperar contraseña" eyebrow="Auth">
            Introduce el email asociado a tu cuenta. Te enviaremos un enlace
            para elegir una contraseña nueva.
          </CardHeader>
          <ForgotPasswordForm />
        </Card>
      </div>
    </div>
  );
}
