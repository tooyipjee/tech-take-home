export { defineRead, defineWrite, getCapability, listCapabilities, clearRegistry } from "./registry.ts";
export { invoke, decideApproval, listApprovals } from "./runtime.ts";
export type { InvokeRequest, ApprovalDecision, ApprovalRow } from "./runtime.ts";
export { listAuditLog, syncRegistry } from "./audit.ts";
export type { AuditEntry } from "./audit.ts";
export { ROLE_SCOPES, resolvePrincipal, listPrincipals } from "./auth.ts";
export { CapabilityError, PolicyDeclarationError } from "./errors.ts";
export type {
  Capability,
  CapabilityContext,
  CapabilityKind,
  InvokeResult,
  Outcome,
  Principal,
  ReadCapability,
  ReadPolicy,
  Role,
  WriteCapability,
  WritePolicy,
} from "./types.ts";
