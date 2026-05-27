import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";

export default function AdminPage() {
  return (
    <Card>
      <CardHeader title="Administración" eyebrow="Ruta legacy">
        La administración real vive en `/profile` para usuarios admin y en el
        flujo de semanas.
      </CardHeader>
      <div className="flex flex-wrap gap-3">
        <Link className="font-semibold text-circuit hover:underline" href="/profile">
          Ir al perfil
        </Link>
        <Link className="font-semibold text-circuit hover:underline" href="/admin/weeks">
          Gestionar semanas
        </Link>
      </div>
    </Card>
  );
}
