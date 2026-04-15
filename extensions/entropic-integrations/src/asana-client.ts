export type AsanaAction =
  | "list_workspaces"
  | "list_teams"
  | "list_projects"
  | "get_project"
  | "create_project"
  | "update_project"
  | "list_sections"
  | "create_section"
  | "list_tasks"
  | "search_tasks"
  | "get_task"
  | "create_task"
  | "update_task"
  | "move_task"
  | "comment_task";

function resolveEntropicWebOrigin(): string {
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

function requireGatewayToken(): string {
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

export async function callAsanaAction(
  action: AsanaAction,
  params: Record<string, unknown>,
): Promise<unknown> {
  const endpoint = new URL("/api/integrations/asana/execute", resolveEntropicWebOrigin());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireGatewayToken()}`,
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
    throw new Error(extractErrorMessage(payload, `Asana request failed with ${response.status}`));
  }

  return payload;
}
