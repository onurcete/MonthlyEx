"use client";

import { useState, type FormEvent } from "react";
import { ChartNoAxesCombined, Lock } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Giriş yapılamadı.");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px", background: "#f8fafc" }}>
      <section
        className="panel"
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "32px 28px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
          <span
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "#ecfdf5",
              color: "#059669",
              display: "grid",
              placeItems: "center",
            }}
          >
            <ChartNoAxesCombined size={22} />
          </span>
          <div>
            <strong style={{ fontSize: "20px", color: "#0f172a", letterSpacing: "-0.5px" }}>
              monthly<span style={{ color: "#059669" }}>ex</span>
            </strong>
            <div style={{ fontSize: "11px", color: "#64748b" }}>Kişisel Finans & Ekstre Analizi</div>
          </div>
        </div>

        <h1 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a", margin: "0 0 6px" }}>Giriş Yap</h1>
        <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 20px", lineHeight: 1.5 }}>
          Harcama verilerinize erişmek için uygulama şifrenizi girin.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "#475569", fontWeight: 500 }}>
            Uygulama Şifresi
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ height: "42px", width: "100%" }}
            />
          </label>

          {error && (
            <p role="alert" style={{ margin: 0, fontSize: "12px", color: "#dc2626", background: "#fef2f2", padding: "8px 10px", borderRadius: "8px" }}>
              {error}
            </p>
          )}

          <button type="submit" className="primary" disabled={busy} style={{ width: "100%", justifyContent: "center", height: "42px", marginTop: "4px" }}>
            <Lock size={15} />
            {busy ? "Kontrol ediliyor…" : "Devam Et"}
          </button>
        </form>
      </section>
    </main>
  );
}
