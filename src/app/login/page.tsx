import { LoginForm } from "@/components/client";
import { Card, Notice, Shell } from "@/components/ui";
import { authMode, isDeployedEnvironment } from "@/server/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const mode = authMode();
  return (
    <Shell>
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Owner sign-in</h1>
        {mode === "local" && !isDeployedEnvironment() ? (
          <Card>
            <LoginForm />
          </Card>
        ) : mode === "local" ? (
          <Notice tone="warn">Local passphrase sign-in is disabled on deployed environments. Configure Supabase Auth (AUTH_MODE=supabase).</Notice>
        ) : (
          <Notice tone="warn">Supabase magic-link sign-in is configured but not yet verified in this build (see docs/deployment-feasibility.md).</Notice>
        )}
        <p className="text-xs text-slate-500">Only allow-listed owner emails can run the agent or decide reviews. Every mutation is checked on the server.</p>
      </div>
    </Shell>
  );
}
