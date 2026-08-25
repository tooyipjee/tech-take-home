import cors from "@fastify/cors";
import Fastify from "fastify";
import { migrate, pool, withClient } from "@platform/db";
import {
  decideApproval,
  invoke,
  listApprovals,
  listAuditLog,
  listCapabilities,
  listPrincipals,
  resolvePrincipal,
  syncRegistry,
} from "@platform/kernel";
import type { Principal } from "@platform/kernel";
import "@platform/capabilities";

const app = Fastify({ logger: { level: "warn" } });
await app.register(cors, { origin: true });

/**
 * Development identity. Production swaps this for OIDC; every route below keeps
 * working because they only ever see a resolved Principal.
 */
async function principalFrom(header: unknown): Promise<Principal | null> {
  const userId = typeof header === "string" && header.length > 0 ? header : "u_agent";
  return withClient((client) => resolvePrincipal(client, userId));
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/users", async () => withClient((client) => listPrincipals(client)));

app.get("/api/capabilities", async () =>
  listCapabilities().map((capability) => ({
    name: capability.name,
    kind: capability.kind,
    summary: capability.summary,
    policy: capability.policy,
  })),
);

app.post<{ Params: { name: string }; Body: { input?: unknown; idempotencyKey?: string } }>(
  "/api/capabilities/:name/invoke",
  async (request, reply) => {
    const principal = await principalFrom(request.headers["x-platform-user"]);
    if (!principal) return reply.code(401).send({ outcome: "denied_scope", message: "unknown user" });

    const result = await invoke({
      capability: request.params.name,
      input: request.body?.input ?? {},
      principal,
      idempotencyKey: request.body?.idempotencyKey,
    });
    return reply.code(statusFor(result.outcome)).send(result);
  },
);

app.get<{ Querystring: { status?: string } }>("/api/approvals", async (request, reply) => {
  const principal = await principalFrom(request.headers["x-platform-user"]);
  if (!principal) return reply.code(401).send({ message: "unknown user" });
  if (!principal.scopes.includes("approvals:read")) {
    return reply.code(403).send({ message: `${principal.role} lacks scope approvals:read` });
  }
  return listApprovals(request.query.status);
});

app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject" } }>(
  "/api/approvals/:id/decide",
  async (request, reply) => {
    const principal = await principalFrom(request.headers["x-platform-user"]);
    if (!principal) return reply.code(401).send({ message: "unknown user" });

    const result = await decideApproval({
      approvalId: request.params.id,
      decision: request.body.decision,
      approver: principal,
    });
    return reply.code(statusFor(result.outcome)).send(result);
  },
);

app.get<{ Querystring: { limit?: string } }>("/api/audit", async (request, reply) => {
  const principal = await principalFrom(request.headers["x-platform-user"]);
  if (!principal) return reply.code(401).send({ message: "unknown user" });
  if (!principal.scopes.includes("audit:read")) {
    return reply.code(403).send({ message: `${principal.role} lacks scope audit:read` });
  }
  return listAuditLog(Number(request.query.limit ?? 100));
});

function statusFor(outcome: string): number {
  switch (outcome) {
    case "ok":
    case "replayed":
      return 200;
    case "pending_approval":
      return 202;
    case "denied_scope":
      return 403;
    case "denied_limit":
      return 422;
    case "rate_limited":
      return 429;
    case "invalid_input":
      return 400;
    case "not_found":
      return 404;
    default:
      return 500;
  }
}

const port = Number(process.env.API_PORT ?? 8080);

try {
  await migrate();
  const count = await syncRegistry();
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`api listening on http://localhost:${port} with ${count} capabilities registered`);
} catch (error) {
  console.error(error);
  await pool.end();
  process.exit(1);
}
