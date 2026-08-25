import type { Actor, CapabilityInput, CapabilityName, CapabilityOutput } from './contracts';

/**
 * The only way this app reaches the outside world.
 *
 * Every result is one of three runtime outcomes, mirroring the kernel's middleware chain:
 * denied (authz/limit/validation), pending_approval (approval tier not satisfied by the caller alone),
 * or ok. `auditId` is always present because the runtime writes the audit row before replying.
 */
export type CapabilityResult<N extends CapabilityName> =
  | { status: 'ok'; auditId: string; output: CapabilityOutput<N> }
  | { status: 'pending_approval'; auditId: string; approvalRequestId: string; message: string }
  | { status: 'denied'; auditId: string; code: DenialCode; message: string };

export type DenialCode =
  | 'forbidden_scope'
  | 'limit_exceeded'
  | 'stale_revision'
  | 'invalid_input'
  | 'self_approval'
  | 'not_found';

export interface InvokeOptions {
  idempotencyKey?: string;
}

export interface CapabilityClient {
  readonly kind: 'mock' | 'http';
  invoke<N extends CapabilityName>(
    capability: N,
    input: CapabilityInput<N>,
    options?: InvokeOptions,
  ): Promise<CapabilityResult<N>>;
  setActor(actor: Actor): void;
}

/** Adapter for the platform API host. Selected when VITE_CAPABILITY_API is set. */
export function createHttpCapabilityClient(baseUrl: string, initialActor: Actor): CapabilityClient {
  let actor = initialActor;
  return {
    kind: 'http',
    setActor(next) {
      actor = next;
    },
    async invoke(capability, input, options) {
      const response = await fetch(`${baseUrl}/v1/capabilities/${capability}/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': actor.userId,
          'x-actor-role': actor.role,
          ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        body: JSON.stringify({ input }),
      });
      return (await response.json()) as never;
    },
  };
}
