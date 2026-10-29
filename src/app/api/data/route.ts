import { NextResponse } from "next/server";
import { loadData } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ ...await loadData(), aiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) }, { headers: { "Cache-Control": "no-store" } });
}
