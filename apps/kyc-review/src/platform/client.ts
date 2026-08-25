import type { InvokeResult, PlatformClient } from '@platform/sdk';
import { createClient } from '@platform/sdk';
import type { Actor, CapabilityOutput, CapabilityName, KycApproval } from './contracts';

/**
 * The only way this app reaches the outside world.
 *
 * It is the platform's `PlatformClient` — same outcomes, same approval and audit surfaces — with
 * two additions the console does not need: the acting identity can change without a reload, and
 * views can subscribe so a mutation refreshes what is on screen.
 */
export interface KycPlatformClient extends PlatformClient {
  readonly kind: 'mock' | 'http';
  setActor(actor: Actor): void;
  approvals(status?: string): Promise<KycApproval[]>;
}

/** Typed view of `invoke` for the capabilities this app declares. */
export type KycResult<N extends CapabilityName> = InvokeResult<CapabilityOutput<N>>;

/**
 * Adapter for the platform API host, selected when VITE_PLATFORM_API is set. It adds nothing to
 * the SDK client but the identity switch: the wire format, the `x-platform-user` header and the
 * idempotency key all belong to the platform.
 */
export function createHttpPlatformClient(baseUrl: string, initialActor: Actor): KycPlatformClient {
  let actor = initialActor;
  const platform = createClient(() => actor.id, baseUrl);
  return {
    ...platform,
    kind: 'http',
    setActor(next) {
      actor = next;
    },
    approvals: (status) => platform.approvals(status) as Promise<KycApproval[]>,
  };
}
