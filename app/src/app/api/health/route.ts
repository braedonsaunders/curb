import { NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/schema";

export async function GET() {
  initializeDatabase();

  return NextResponse.json({
    app: "curb",
    ok: true,
    timestamp: new Date().toISOString(),
  });
}
