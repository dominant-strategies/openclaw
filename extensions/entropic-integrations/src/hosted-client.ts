export function resolveEntropicWebOrigin(): string {
  const raw =
    process.env.ENTROPIC_WEB_BASE_URL?.trim() || process.env.ENTROPIC_PROXY_BASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "Hosted integrations are unavailable because ENTROPIC_WEB_BASE_URL is not configured.",
    );
  }

  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Invalid hosted integrations base URL: ${raw}`);
  }
}

export function requireHostedGatewayToken(): string {
  const token =
    process.env.ENTROPIC_WEB_AUTH_TOKEN?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  if (token.startsWith("gw_") || token.startsWith("gw_an_")) {
    return token;
  }

  const fallback = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (fallback && (fallback.startsWith("gw_") || fallback.startsWith("gw_an_"))) {
    return fallback;
  }

  if (!token) {
    throw new Error(
      "Hosted integrations are unavailable because the Entropic web auth token is missing.",
    );
  }

  throw new Error(
    "Hosted integrations are unavailable because the runtime is using a local gateway token instead of an Entropic web auth token.",
  );
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string" &&
    payload.error.message.trim()
  ) {
    return payload.error.message.trim();
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  return fallback;
}

export async function callHostedIntegrationAction(
  providerPath: string,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const endpoint = new URL(
    `/api/integrations/${providerPath}/execute`,
    resolveEntropicWebOrigin(),
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireHostedGatewayToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      params,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = await response.text().catch(() => null);
  }

  if (!response.ok) {
    throw new Error(
      extractErrorMessage(payload, `${providerPath} request failed with ${response.status}`),
    );
  }

  return payload;
}
