import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type IntegrationRecord = {
  provider: string;
  type: "oauth2";
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  scopes?: string[];
  provider_email?: string;
  provider_user_id?: string;
  metadata?: Record<string, unknown>;
  updated_at?: number;
};

export type IntegrationStore = {
  version: number;
  integrations: Record<string, IntegrationRecord>;
};

const STORE_VERSION = 1;

function resolveCredentialsDir(): string {
  const oauthOverride = process.env.OPENCLAW_OAUTH_DIR?.trim();
  if (oauthOverride) return oauthOverride;
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "credentials");
}

export function resolveIntegrationsPath(): string {
  return path.join(resolveCredentialsDir(), "integrations.json");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadIntegrationStoreSync(filePath: string): IntegrationStore {
  if (!fs.existsSync(filePath)) {
    return { version: STORE_VERSION, integrations: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as IntegrationStore;
    if (!parsed || typeof parsed !== "object") {
      return { version: STORE_VERSION, integrations: {} };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : STORE_VERSION,
      integrations: parsed.integrations || {},
    };
  } catch {
    return { version: STORE_VERSION, integrations: {} };
  }
}

export function saveIntegrationStoreSync(filePath: string, store: IntegrationStore) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.chmodSync(filePath, 0o600);
}

export function upsertIntegration(api: OpenClawPluginApi, record: IntegrationRecord) {
  const filePath = resolveIntegrationsPath();
  const store = loadIntegrationStoreSync(filePath);
  store.integrations[record.provider] = {
    ...record,
    updated_at: Date.now(),
  };
  saveIntegrationStoreSync(filePath, store);
  api.logger.info(`[entropic-integrations] stored ${record.provider} tokens`);
}

export function removeIntegration(api: OpenClawPluginApi, provider: string) {
  const filePath = resolveIntegrationsPath();
  const store = loadIntegrationStoreSync(filePath);
  if (store.integrations[provider]) {
    delete store.integrations[provider];
    saveIntegrationStoreSync(filePath, store);
    api.logger.info(`[entropic-integrations] removed ${provider} tokens`);
  }
}

export function getIntegration(provider: string): IntegrationRecord | null {
  const filePath = resolveIntegrationsPath();
  const store = loadIntegrationStoreSync(filePath);
  return store.integrations[provider] ?? null;
}

export function updateIntegration(provider: string, patch: Partial<IntegrationRecord>) {
  const filePath = resolveIntegrationsPath();
  const store = loadIntegrationStoreSync(filePath);
  const current = store.integrations[provider];
  if (!current) {
    return null;
  }
  store.integrations[provider] = { ...current, ...patch, updated_at: Date.now() };
  saveIntegrationStoreSync(filePath, store);
  return store.integrations[provider];
}
