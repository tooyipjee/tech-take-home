import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Actor,
  CapabilityInput,
  CapabilityName,
  CapabilityOutput,
  CapabilityRegistry,
  KycCapabilityDescriptor,
} from './contracts';
import { toRegistry } from './contracts';
import type { KycPlatformClient, KycResult } from './client';
import { createPlatformClient } from './client';

export interface Toast {
  id: number;
  tone: 'ok' | 'held' | 'denied';
  title: string;
  detail: string;
}

interface PlatformContextValue {
  actor: Actor;
  directory: Actor[];
  setActorId: (userId: string) => void;
  client: KycPlatformClient;
  /** The registry as the platform serves it, so the UI states the rule it is actually under. */
  registry: CapabilityRegistry;
  /** Version counter that changes whenever an invocation may have moved state, so views refetch. */
  version: number;
  bump: () => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  invoke: <N extends CapabilityName>(
    capability: N,
    input: CapabilityInput<N>,
    options?: { idempotencyKey?: string; successMessage?: string; silent?: boolean },
  ) => Promise<KycResult<N>>;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/** Outcomes the runtime can return that are refusals rather than results. */
const REFUSED = new Set([
  'denied_scope',
  'denied_limit',
  'rate_limited',
  'invalid_input',
  'not_found',
  'conflict',
  'halted',
  'invariant_violation',
  'error',
]);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<KycPlatformClient>();
  if (!clientRef.current) clientRef.current = createPlatformClient();
  const client = clientRef.current;

  // Identity is the platform's: the directory is the seeded platform users, not a list
  // this app keeps, and switching identity only changes which one the SDK sends.
  const [directory, setDirectory] = useState<Actor[]>([]);
  const [registry, setRegistry] = useState<CapabilityRegistry>({});
  const [actorId, setActorId] = useState<string | null>(null);
  const actor = directory.find((entry) => entry.id === actorId) ?? null;

  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    void client.users().then((users) => {
      setDirectory(users);
      setActorId((current) => current ?? users[0]?.id ?? null);
    });
    void client.capabilities().then((descriptors) => setRegistry(toRegistry(descriptors)));
  }, [client]);

  useEffect(() => {
    if (!actor) return;
    client.setActor(actor);
    bump();
  }, [client, actor, bump]);

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 9000);
  }, []);

  const invoke = useCallback<PlatformContextValue['invoke']>(
    async (capability, input, options) => {
      const result = (await client.invoke(capability, input, options?.idempotencyKey)) as KycResult<
        typeof capability
      >;
      if (capability.startsWith('kyc.case.')) bump();
      if (!options?.silent) {
        if (REFUSED.has(result.outcome)) {
          pushToast({
            tone: 'denied',
            title: result.outcome.replace(/_/g, ' '),
            detail: result.message ?? capability,
          });
        } else if (result.outcome === 'pending_approval') {
          pushToast({ tone: 'held', title: 'Held for approval', detail: result.message ?? capability });
        } else if (options?.successMessage) {
          pushToast({ tone: 'ok', title: options.successMessage, detail: capability });
        }
      }
      return result;
    },
    [client, pushToast, bump],
  );

  const value = useMemo<Omit<PlatformContextValue, 'actor'>>(
    () => ({
      directory,
      setActorId,
      client,
      registry,
      version,
      bump,
      toasts,
      dismissToast: (id) => setToasts((current) => current.filter((item) => item.id !== id)),
      invoke,
    }),
    [directory, registry, client, version, bump, toasts, invoke],
  );

  if (!actor) return <div className="boot">Connecting to the platform…</div>;
  return (
    <PlatformContext.Provider value={{ ...value, actor }}>{children}</PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformContextValue {
  const context = useContext(PlatformContext);
  if (!context) throw new Error('usePlatform must be used inside PlatformProvider');
  return context;
}

/** Fetches a read capability and refetches whenever platform state changes. */
export function useCapability<N extends CapabilityName>(
  capability: N,
  input: CapabilityInput<N>,
  enabled = true,
): { data: CapabilityOutput<N> | null; loading: boolean; error: string | null } {
  const { invoke, version } = usePlatform();
  const [data, setData] = useState<CapabilityOutput<N> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const serialized = JSON.stringify(input);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    invoke(capability, JSON.parse(serialized) as CapabilityInput<N>, { silent: true })
      .then((result) => {
        if (cancelled) return;
        if (result.outcome === 'ok' || result.outcome === 'replayed') {
          setData(result.result ?? null);
          setError(null);
        } else {
          setData(null);
          setError(result.message ?? result.outcome);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capability, serialized, enabled, invoke, version]);

  return { data, loading, error };
}

/** Reads a platform surface (approvals, audit, registry) that is not a KYC capability. */
export function usePlatformData<T>(load: (client: KycPlatformClient) => Promise<T>, deps: unknown[] = []) {
  const { client, version } = usePlatform();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(client)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, version, ...deps]);

  return { data, error };
}

/** The served declaration for one capability, or null before the registry has loaded. */
export function useDescriptor(capability: CapabilityName): KycCapabilityDescriptor | null {
  const { registry } = usePlatform();
  return registry[capability] ?? null;
}
