import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";

type AdminGateMessageProps = {
  title: string;
  description: string;
  showLogin?: boolean;
};

export function AdminGateMessage({
  title,
  description,
  showLogin,
}: AdminGateMessageProps) {
  return (
    <Card>
      <CardHeader title={title} eyebrow="Administración">
        {description}
      </CardHeader>
      {showLogin ? (
        <Link className="font-semibold text-circuit hover:underline" href="/login">
          Iniciar sesión
        </Link>
      ) : null}
    </Card>
  );
}
