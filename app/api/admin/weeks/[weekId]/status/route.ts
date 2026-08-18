import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json({
    ok: false,
    code: "WEEK_STATUS_DIRECT_WRITE_DEPRECATED",
    error: "El estado de semana se deriva del calendario. Actualiza la semana mediante la API canónica para ejecutar su reconciliación.",
  }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
