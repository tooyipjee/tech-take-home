import { z } from "zod";
import { PolicyDeclarationError } from "./errors.ts";
import type { Capability, ReadCapability, WriteCapability } from "./types.ts";

const writePolicySchema = z.object({
  scope: z.string().min(1),
  idempotent: z.literal(true),
  limits: z.object({
    maxAmountCents: z.number().int().positive().nullable(),
    maxPerHour: z.number().int().positive(),
  }),
  approval: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("never") }),
    z.object({ mode: z.literal("always") }),
    z.object({ mode: z.literal("above_amount"), amountCents: z.number().int().nonnegative() }),
  ]),
  approverScope: z.string().min(1),
  amountField: z.string().min(1).optional(),
});

const readPolicySchema = z.object({
  scope: z.string().min(1),
  maxRows: z.number().int().positive().max(1000),
});

const registry = new Map<string, Capability>();

function assertUnique(name: string): void {
  if (registry.has(name)) throw new PolicyDeclarationError(`capability already registered: ${name}`);
}

export function defineRead<I extends z.ZodTypeAny, O>(
  capability: Omit<ReadCapability<I, O>, "kind">,
): ReadCapability<I, O> {
  assertUnique(capability.name);
  const parsed = readPolicySchema.safeParse(capability.policy);
  if (!parsed.success) {
    throw new PolicyDeclarationError(
      `read capability ${capability.name} has an invalid policy: ${parsed.error.message}`,
    );
  }
  const registered: ReadCapability<I, O> = { ...capability, kind: "read" };
  registry.set(capability.name, registered as unknown as Capability);
  return registered;
}

export function defineWrite<I extends z.ZodTypeAny, O>(
  capability: Omit<WriteCapability<I, O>, "kind">,
): WriteCapability<I, O> {
  assertUnique(capability.name);
  const parsed = writePolicySchema.safeParse(capability.policy);
  if (!parsed.success) {
    throw new PolicyDeclarationError(
      `write capability ${capability.name} has an invalid policy: ${parsed.error.message}`,
    );
  }
  const policy = capability.policy;
  const needsAmount = policy.limits.maxAmountCents !== null || policy.approval.mode === "above_amount";
  if (needsAmount && !policy.amountField) {
    throw new PolicyDeclarationError(
      `write capability ${capability.name} declares an amount-based limit or approval rule but no amountField`,
    );
  }
  const registered: WriteCapability<I, O> = { ...capability, kind: "write" };
  registry.set(capability.name, registered as unknown as Capability);
  return registered;
}

export function getCapability(name: string): Capability | undefined {
  return registry.get(name);
}

export function listCapabilities(): Capability[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Test helper; production code registers once at import time. */
export function clearRegistry(): void {
  registry.clear();
}
