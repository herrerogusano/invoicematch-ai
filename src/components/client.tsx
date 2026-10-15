"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `request failed (${res.status})`);
  return data;
}

function newKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await postJson("/api/auth/login", { email: form.get("email"), passphrase: form.get("passphrase") });
          router.push("/owner");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm">
        <span className="text-slate-600">Owner email</span>
        <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">Passphrase</span>
        <input name="passphrase" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function MagicLinkForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") {
    return <p className="text-sm text-slate-700">If that address is an owner account, a sign-in link is on its way. Open it in this browser within 10 minutes.</p>;
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setState("sending");
        setError(null);
        try {
          await postJson("/api/auth/magic-link", { email: form.get("email") });
          setState("sent");
        } catch (err) {
          setError((err as Error).message);
          setState("error");
        }
      }}
    >
      <label className="block text-sm">
        <span className="text-slate-600">Owner email</span>
        <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm text-slate-500 underline hover:text-slate-900"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export function RunScenarioButton({ scenarioId }: { scenarioId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        disabled={state === "running"}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        onClick={async () => {
          setState("running");
          setError(null);
          try {
            // A fresh idempotency key per click; retries of the same request reuse it server-side.
            const out = await postJson("/api/reconciliations", { scenarioId, idempotencyKey: newKey("ui-run") });
            router.push(`/owner/reconciliations/${out.reconciliationId}`);
          } catch (err) {
            setState("error");
            setError((err as Error).message);
          }
        }}
      >
        {state === "running" ? "Running workflow…" : "Run reconciliation"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-rose-700">{error}</span>}
    </div>
  );
}

export function DecisionForm({ reconciliationId }: { reconciliationId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per form instance: double clicks or network retries cannot create a second decision.
  const [key] = useState(() => newKey("ui-decision"));

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(decision);
    setError(null);
    try {
      await postJson(`/api/reconciliations/${reconciliationId}/decision`, { decision, reason, idempotencyKey: key });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const valid = reason.trim().length >= 5;
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-600">Reason (required, recorded in the immutable audit trail)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          placeholder="e.g. Price increase confirmed by the supplier in writing"
        />
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={!valid || busy !== null} onClick={() => decide("APPROVE")} className="rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy === "APPROVE" ? "Resuming workflow…" : "Approve exception"}
        </button>
        <button disabled={!valid || busy !== null} onClick={() => decide("REJECT")} className="rounded-md bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy === "REJECT" ? "Resuming workflow…" : "Reject"}
        </button>
      </div>
      <p className="text-xs text-slate-500">Approving records a human exception only. No payment is made.</p>
    </div>
  );
}
