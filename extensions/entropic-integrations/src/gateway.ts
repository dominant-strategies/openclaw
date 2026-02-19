import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { upsertIntegration, removeIntegration } from "./store.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function registerIntegrationGatewayMethods(api: OpenClawPluginApi) {
  api.registerGatewayMethod("integrations.import", async ({ params, respond }) => {
    try {
      const provider = asString(params.provider);
      const accessToken = asString(params.access_token);
      if (!provider || !accessToken) {
        respond(false, { error: "provider and access_token required" });
        return;
      }

      const record = {
        provider,
        type: "oauth2" as const,
        access_token: accessToken,
        refresh_token: asString(params.refresh_token),
        token_type: asString(params.token_type),
        expires_at: asNumber(params.expires_at),
        scopes: asStringArray(params.scopes),
        provider_email: asString(params.provider_email),
        provider_user_id: asString(params.provider_user_id),
        metadata:
          typeof params.metadata === "object"
            ? (params.metadata as Record<string, unknown>)
            : undefined,
      };

      await upsertIntegration(api, record);
      respond(true, { ok: true, provider });
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("integrations.remove", async ({ params, respond }) => {
    try {
      const provider = asString(params.provider);
      if (!provider) {
        respond(false, { error: "provider required" });
        return;
      }
      await removeIntegration(api, provider);
      respond(true, { ok: true, provider });
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
