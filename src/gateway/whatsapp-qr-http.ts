import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeGatewayConnect } from "./auth.js";
import { getBearerToken } from "./http-utils.js";
import { readJsonBodyOrError } from "./http-common.js";
import { ensureWebLogin, getWebLoginSnapshot } from "../web/login-qr.js";

type WhatsAppQrHttpOptions = {
  auth: import("./auth.js").ResolvedGatewayAuth;
  trustedProxies: string[];
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function handleWhatsAppQrHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WhatsAppQrHttpOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/channels/whatsapp/qr") return false;

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: { token, password: token },
    req,
    trustedProxies: opts.trustedProxies,
  });
  if (!authResult.ok) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Unauthorized");
    return true;
  }

  const action = url.searchParams.get("action")?.trim() || "status";
  const force = url.searchParams.get("force") === "1";

  if (req.method === "POST") {
    await readJsonBodyOrError(req, res, 128 * 1024);
  }

  const result = action === "start" ? await ensureWebLogin({ force }) : await getWebLoginSnapshot();

  sendJson(res, 200, result);
  return true;
}
