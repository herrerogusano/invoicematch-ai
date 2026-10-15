import { LoginForm, MagicLinkForm } from "@/components/client";
import { Card, Notice, Shell } from "@/components/ui";
import { authMode, isDeployedEnvironment } from "@/server/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  link: "That sign-in link is invalid, expired or was opened in a different browser. Request a new one.",
  forbidden: "That email is not an owner account.",
  disabled: "Magic-link sign-in is not enabled.",
  server: "Sign-in failed on the server. Try again later.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const mode = authMode();
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.server) : null;
  return (
    <Shell>
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Owner sign-in</h1>
        {message && <Notice tone="error">{message}</Notice>}
        {mode === "supabase" ? (
          <Card>
            <MagicLinkForm />
          </Card>
        ) : !isDeployedEnvironment() ? (
          <Card>
            <LoginForm />
          </Card>
        ) : (
          <Notice tone="warn">Local passphrase sign-in is disabled on deployed environments. Configure Supabase Auth (AUTH_MODE=supabase).</Notice>
        )}
        <p className="text-xs text-slate-500">Only allow-listed owner emails can run the agent or decide reviews. Every mutation is checked on the server.</p>
      </div>
    </Shell>
  );
}
