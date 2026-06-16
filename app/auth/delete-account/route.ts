import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "El borrado físico de cuenta está deshabilitado. La eliminación futura se implementará como anonimización.",
    },
    { status: 410 },
  );
}
