import { NextResponse } from "next/server";
import { AUTH_COOKIE, expectedAuthToken } from "@/lib/auth";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.json({ ok: true });

  const body = await request.json().catch(() => null);
  const input = typeof body?.password === "string" ? body.password.trim() : "";

  if (!input || input !== password) {
    return NextResponse.json({ error: "Şifre hatalı." }, { status: 401 });
  }

  const token = await expectedAuthToken(password);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return response;
}
