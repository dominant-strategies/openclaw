import { getIntegration } from "./store.js";

export async function getGoogleAccessToken(provider: string): Promise<string> {
  const record = await getIntegration(provider);
  if (!record) {
    throw new Error(`${provider} integration not configured`);
  }
  const expiresAt = record.expires_at;
  const now = Date.now();
  if (!record.access_token) {
    throw new Error(`${provider} access token missing`);
  }
  if (!expiresAt) {
    return record.access_token;
  }
  if (expiresAt - now > 5 * 60 * 1000) {
    return record.access_token;
  }
  throw new Error(`${provider} access token expired. Refresh in Entropic.`);
}
