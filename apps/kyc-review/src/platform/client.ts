import type { InvokeResult, PlatformClient } from '@platform/sdk';
import { createClient } from '@platform/sdk';
import type { Actor, CapabilityOutput, CapabilityName, KycApproval } from './contracts';

/**
 * The only way this app reaches the outside world.
 *
 * It is the part of the platform's `PlatformClient` this app uses — same outcomes, same approval
 * and audit surfaces, minus invariant administration, which is the console's job — with one addition
 * the console does not need: the acting identity can change without a reload.
 */
type UsedSurface = Pick<
  PlatformClient,
  'invoke' | 'users' | 'capabilities' | 'decide' | 'audit'
>;

export interface KycPlatformClient extends UsedSurface {
  setActor(actor: Actor): void;
  approvals(status?: string): Promise<KycApproval[]>;
}

/** Typed view of `invoke` for the capabilities this app declares. */
export type KycResult<N extends CapabilityName> = InvokeResult<CapabilityOutput<N>>;

/**
 * The platform API host, which Vite proxies at /api. It adds nothing to the SDK client but
 * the identity switch: the wire format, the `x-platform-user` header and the idempotency key
 * all belong to the platform. There is no second implementation — an in-app kernel would be a
 * second copy of the rules, free to be more permissive than the one that is enforced.
 */
export function createPlatformClient(baseUrl = '/api'): KycPlatformClient {
  let actorId = '';
  const platform = createClient(() => actorId, baseUrl);
  return {
    ...platform,
    setActor(next) {
      actorId = next.id;
    },
    approvals: (status) => platform.approvals(status) as Promise<KycApproval[]>,
  };
}
