"use client";

import { FormEvent, useState } from "react";

type Mode = "login" | "register";

export function AuthPanel({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const payload =
      mode === "login"
        ? {
            email: String(form.get("email")),
            password: String(form.get("password")),
          }
        : {
            name: String(form.get("name")),
            email: String(form.get("email")),
            password: String(form.get("password")),
          };

    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch((error) => {
        console.error("Failed to parse authentication error response", error);
        return { error: "Unable to authenticate" };
      });
      setMessage(body.error ?? "Unable to authenticate");
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <aside className={compact ? "auth-card auth-card-compact" : "auth-card"} aria-label="Sign in or register">
      {!compact && (
        <div className="auth-card-header">
          <div className="auth-brand" aria-hidden>
            <span className="auth-brand-orb">P</span>
          </div>
          <div>
            <div className="eyebrow">Account</div>
            <h2>{mode === "login" ? "Welcome back" : "Create an account"}</h2>
            <p>Sign in with email, Google, or register to start on the free tier.</p>
          </div>
        </div>
      )}

      <a className="google-auth-button" href="/api/auth/google/start">
        <span aria-hidden>G</span>
        Continue with Google
      </a>

      <div className="auth-tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          Login
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Register
        </button>
      </div>

      <form onSubmit={submit} className="form-stack">
        {mode === "register" && (
          <label>
            Name
            <input name="name" required minLength={2} placeholder="Aman Jain" />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            placeholder={mode === "login" ? "demo@agentsim.local" : "you@company.com"}
            defaultValue={mode === "login" ? "demo@agentsim.local" : ""}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            placeholder={mode === "login" ? "demo123" : "Minimum 6 characters"}
            defaultValue={mode === "login" ? "demo123" : ""}
          />
        </label>
        <button className="primary-button" disabled={loading}>
          {loading ? "Opening..." : mode === "login" ? "Enter Dashboard" : "Start Free Tier"}
        </button>
      </form>

      {message.trim() && <p className="form-message">{message}</p>}

      {!compact && <div className="demo-note">
        Admin seed: <strong>admin@agentsim.local</strong> / <strong>admin123</strong>
      </div>}
    </aside>
  );
}
