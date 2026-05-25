import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";

export default function LegacyProfileSetupPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader title="Profile setup" eyebrow="Ruta legacy">
          Esta página ya no forma parte del flujo normal. El perfil real se
          gestiona desde `/profile`.
        </CardHeader>
        <Link className="font-semibold text-circuit hover:underline" href="/profile">
          Ir a perfil
        </Link>
      </Card>
    </div>
  );
}
