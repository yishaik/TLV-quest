"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type PortalData = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    monthly_run_quota: number;
    active_run_quota: number;
    participant_quota: number;
    storage_mb_quota: number;
    branding: Record<string, unknown>;
  };
  access: { email: string; role: string };
  usage: {
    runs: number;
    activeRuns: number;
    participants: number;
    storageBytes: number;
    aiRequests: number;
  };
  runs: Array<{
    id: string;
    public_code: string;
    status: string;
    max_participants: number;
    created_at: string;
  }>;
  templates: Array<{
    id: string;
    slug: string;
    title: { he?: string; en?: string };
    is_active: boolean;
    active_version: number;
  }>;
  anomalies: Array<{
    id: string;
    kind: string;
    severity: string;
    status: string;
    occurrences: number;
    last_detected_at: string;
  }>;
};

const percent = (value: number, quota: number) =>
  `${Math.min(100, Math.round((value / Math.max(1, quota)) * 100))}%`;

export function OrganizerPortal() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<PortalData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [branding, setBranding] = useState({
    productName: "",
    primaryColor: "#f6c35b",
    surfaceColor: "#08131f",
    logoUrl: "/visuals/quest-mark.svg"
  });

  useEffect(() => {
    let active = true;
    void getBrowserClient()
      .auth.getSession()
      .then(({ data: session }) => {
        if (active) setToken(session.session?.access_token ?? "");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void fetch("/api/admin/portal", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` }
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error?.message ?? "Portal failed");
        if (!active) return;
        const next = payload.data as PortalData;
        setData(next);
        setBranding({
          productName: String(next.tenant.branding.productName ?? next.tenant.name),
          primaryColor: String(next.tenant.branding.primaryColor ?? "#f6c35b"),
          surfaceColor: String(next.tenant.branding.surfaceColor ?? "#08131f"),
          logoUrl: String(next.tenant.branding.logoUrl ?? "/visuals/quest-mark.svg")
        });
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Portal failed");
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function saveBranding(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/portal", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ branding })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Branding update failed");
      }
      setMessage("המיתוג נשמר ויוחל על הרצות חדשות וקיימות.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Branding update failed");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeAnomaly(id: string) {
    const response = await fetch("/api/admin/portal", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ anomalyId: id, status: "acknowledged" })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setError(payload.error?.message ?? "Anomaly update failed");
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            anomalies: current.anomalies.map((anomaly) =>
              anomaly.id === id
                ? { ...anomaly, status: "acknowledged" }
                : anomaly
            )
          }
        : current
    );
  }

  if (!token) {
    return (
      <main className="site-shell page">
        <span className="badge">Organizer portal</span>
        <h1 className="page-title">נדרשת כניסת מנהל</h1>
        <Link className="button button-primary" href="/admin">
          מעבר לכניסה
        </Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="site-shell page">
        <p>{error || "טוען סביבת ארגון…"}</p>
      </main>
    );
  }

  const quotaCards = [
    ["הרצות החודש", data.usage.runs, data.tenant.monthly_run_quota],
    ["הרצות פעילות", data.usage.activeRuns, data.tenant.active_run_quota],
    ["משתתפים", data.usage.participants, data.tenant.participant_quota],
    [
      "אחסון MB",
      Math.round(data.usage.storageBytes / 1024 / 1024),
      data.tenant.storage_mb_quota
    ]
  ] as const;

  return (
    <main className="site-shell page organizer-portal">
      <span className="badge">Tenant · {data.tenant.slug}</span>
      <h1 className="page-title">{data.tenant.name}</h1>
      <p className="lead">
        תוכנית {data.tenant.plan} · הרשאת {data.access.role} · {data.access.email}
      </p>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <section className="portal-quota-grid">
        {quotaCards.map(([label, value, quota]) => (
          <article className="card" key={label}>
            <span className="badge">{label}</span>
            <h2>
              {value} / {quota}
            </h2>
            <div className="portal-meter">
              <span style={{ width: percent(value, quota) }} />
            </div>
          </article>
        ))}
      </section>

      <section className="card portal-branding">
        <div>
          <span className="badge">White label</span>
          <h2>מיתוג חוויית השחקן</h2>
          <p className="muted">
            צבעים, שם ולוגו עוברים דרך רשימת ערכים בטוחה ומוצגים בזמן אמת.
          </p>
        </div>
        <form className="form-grid" onSubmit={saveBranding}>
          <div className="field">
            <label>שם מוצר</label>
            <input
              value={branding.productName}
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  productName: event.target.value
                }))
              }
            />
          </div>
          <div className="field">
            <label>צבע ראשי</label>
            <input
              type="color"
              value={branding.primaryColor}
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  primaryColor: event.target.value
                }))
              }
            />
          </div>
          <div className="field">
            <label>צבע רקע</label>
            <input
              type="color"
              value={branding.surfaceColor}
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  surfaceColor: event.target.value
                }))
              }
            />
          </div>
          <div className="field">
            <label>כתובת לוגו HTTPS או נתיב מקומי</label>
            <input
              value={branding.logoUrl}
              onChange={(event) =>
                setBranding((current) => ({
                  ...current,
                  logoUrl: event.target.value
                }))
              }
            />
          </div>
          <button className="button button-primary" disabled={busy}>
            {busy ? "שומר…" : "שמירת מיתוג"}
          </button>
        </form>
      </section>

      <section className="portal-columns">
        <article className="card">
          <span className="badge">Routes</span>
          <h2>{data.templates.length} מסלולים</h2>
          {data.templates.map((template) => (
            <div className="portal-row" key={template.id}>
              <span>{template.title.he || template.title.en || template.slug}</span>
              <small>v{template.active_version}</small>
            </div>
          ))}
          <Link className="button button-secondary" href="/admin/content">
            פתיחת Content Studio
          </Link>
        </article>
        <article className="card">
          <span className="badge">Operations</span>
          <h2>חריגות פתוחות</h2>
          {data.anomalies
            .filter((anomaly) => anomaly.status === "open")
            .map((anomaly) => (
              <div className="portal-row" key={anomaly.id}>
                <span>
                  <strong>{anomaly.kind}</strong>
                  <small>
                    {anomaly.severity} · {anomaly.occurrences} זיהויים
                  </small>
                </span>
                <button
                  className="button button-secondary"
                  onClick={() => void acknowledgeAnomaly(anomaly.id)}
                >
                  אישור
                </button>
              </div>
            ))}
          {!data.anomalies.some((anomaly) => anomaly.status === "open") && (
            <p className="muted">אין חריגות פתוחות.</p>
          )}
        </article>
      </section>
    </main>
  );
}
