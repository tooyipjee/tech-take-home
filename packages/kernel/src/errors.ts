import type { Outcome } from "./types.ts";

export class CapabilityError extends Error {
  constructor(
    readonly outcome: Outcome,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

export class PolicyDeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyDeclarationError";
  }
}
