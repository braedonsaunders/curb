import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  buildOpenAIAuthorizeUrl,
  buildOpenAIOAuthConfigUpdates,
  clearOpenAIOAuthConfigUpdates,
  createOpenAIPkcePair,
  DEFAULT_OPENAI_OAUTH_MODEL,
  exchangeOpenAICode,
  exchangeOpenAITokenForApiKey,
  OPENAI_OAUTH_CODEX_MODELS,
} from "./openai-oauth";
import { getConfig, updateConfig } from "./config";

const CALLBACK_PORT = 1455;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export interface OpenAIOAuthFlowState {
  status: "idle" | "pending" | "complete" | "error";
  error?: string;
  authorizeUrl?: string;
}

let callbackServer: Server | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
let flowState: OpenAIOAuthFlowState = { status: "idle" };

function successPage(): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
    <div style="text-align:center">
      <div style="font-size:48px;margin-bottom:16px">&#10003;</div>
      <h1 style="margin:0 0 8px">Authentication Successful</h1>
      <p style="color:#888">You can close this tab and return to Curb.</p>
    </div>
  </body></html>`;
}

function errorPage(error: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
    <div style="text-align:center">
      <div style="font-size:48px;margin-bottom:16px">&#10007;</div>
      <h1 style="margin:0 0 8px">Authentication Failed</h1>
      <p style="color:#f87171;max-width:560px">${error}</p>
      <p style="color:#888;margin-top:16px">You can close this tab and try again.</p>
    </div>
  </body></html>`;
}

function cleanup(nextState: OpenAIOAuthFlowState | null = null): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }

  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }

  if (nextState) {
    flowState = nextState;
  } else if (flowState.status === "pending") {
    flowState = { status: "idle" };
  }
}

export function getOpenAIOAuthFlowState(): OpenAIOAuthFlowState {
  return { ...flowState };
}

export function cancelOpenAIOAuthFlow(): void {
  cleanup({ status: "idle" });
}

export async function startOpenAIOAuthFlow(): Promise<string> {
  if (callbackServer) {
    cleanup({ status: "idle" });
  }

  flowState = { status: "pending" };

  const { verifier, challenge } = createOpenAIPkcePair();
  const state = verifier;
  const authorizeUrl = buildOpenAIAuthorizeUrl(state, challenge);

  return await new Promise<string>((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname !== "/auth/callback") {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const returnedState = url.searchParams.get("state");

        if (error) {
          const nextState = { status: "error" as const, error };
          flowState = nextState;
          res.writeHead(200, { "content-type": "text/html" });
          res.end(errorPage(error));
          setTimeout(() => cleanup(nextState), 1000);
          return;
        }

        if (!code) {
          const nextState = {
            status: "error" as const,
            error: "No authorization code received.",
          };
          flowState = nextState;
          res.writeHead(200, { "content-type": "text/html" });
          res.end(errorPage(nextState.error));
          setTimeout(() => cleanup(nextState), 1000);
          return;
        }

        if (returnedState && returnedState !== state) {
          const nextState = {
            status: "error" as const,
            error: "OpenAI OAuth state mismatch.",
          };
          flowState = nextState;
          res.writeHead(200, { "content-type": "text/html" });
          res.end(errorPage(nextState.error));
          setTimeout(() => cleanup(nextState), 1000);
          return;
        }

        try {
          const existing = getConfig();
          const tokens = await exchangeOpenAICode(code, verifier);

          let platformApiKey = existing.openaiOAuthApiKey;
          if (tokens.id_token) {
            try {
              platformApiKey = await exchangeOpenAITokenForApiKey(tokens.id_token);
            } catch {
              // Fall back to ChatGPT/Codex backend mode when token exchange is unavailable.
            }
          }

          const nextModel =
            platformApiKey || OPENAI_OAUTH_CODEX_MODELS.has(existing.openaiModel)
              ? existing.openaiModel
              : DEFAULT_OPENAI_OAUTH_MODEL;

          updateConfig({
            ...buildOpenAIOAuthConfigUpdates(tokens, {
              refreshToken: existing.openaiOAuthRefreshToken,
              expiresAtMs: existing.openaiOAuthExpiresAtMs,
              authMode: "oauth",
              platformApiKey,
              existingPlatformApiKey: existing.openaiOAuthApiKey,
              existingAccountId: existing.openaiOAuthAccountId,
            }),
            openaiModel: nextModel,
          });

          const nextState = { status: "complete" as const };
          flowState = nextState;
          res.writeHead(200, { "content-type": "text/html" });
          res.end(successPage());
          setTimeout(() => cleanup(nextState), 1000);
        } catch (caughtError) {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : String(caughtError);
          const nextState = { status: "error" as const, error: message };
          flowState = nextState;
          res.writeHead(200, { "content-type": "text/html" });
          res.end(errorPage(message));
          setTimeout(() => cleanup(nextState), 1000);
        }
      }
    );

    callbackServer = server;
    flowState = { status: "pending", authorizeUrl };

    cleanupTimer = setTimeout(() => {
      cleanup({
        status: "error",
        error: "OpenAI OAuth callback timed out after 5 minutes.",
      });
    }, CALLBACK_TIMEOUT_MS);

    server.listen(CALLBACK_PORT, () => resolve(authorizeUrl));
    server.on("error", (error) => {
      cleanup({ status: "error", error: String(error) });
      reject(error);
    });
  });
}

export function disconnectOpenAIOAuth(): void {
  updateConfig(clearOpenAIOAuthConfigUpdates("apiKey"));
  cancelOpenAIOAuthFlow();
}
