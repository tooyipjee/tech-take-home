export { defineRead, defineWrite, getCapability, listCapabilities, clearRegistry } from "./registry.ts";
export { invoke, decideApproval, listApprovals, previewApproval } from "./runtime.ts";
export type {
  ApprovalDecision,
  ApprovalRequirement,
  ApprovalRow,
  InvokeRequest,
} from "./runtime.ts";
export { listAuditLog, syncRegistry } from "./audit.ts";
export {
  invariants,
  checkInvariant,
  getInvariant,
  invariantsFor,
  invariantsHalting,
  describeViolations,
} from "./invariants.ts";
export type { Invariant, InvariantViolation } from "./invariants.ts";
export {
  reconcile,
  startReconciler,
  listInvariantStatus,
  listHalts,
  clearHalt,
} from "./reconciler.ts";
export type { InvariantStatus, HaltRow, ReconciliationResult, ClearHaltResult } from "./reconciler.ts";
export type { AuditEntry } from "./audit.ts";
export { ROLE_SCOPES, resolvePrincipal, listPrincipals } from "./auth.ts";
export { CapabilityError, PolicyDeclarationError } from "./errors.ts";
export type {
  ApprovalRule,
  Capability,
  CapabilityContext,
  EffectDeclaration,
  SubjectApprovalClause,
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
