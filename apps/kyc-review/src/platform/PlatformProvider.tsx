import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Actor, CapabilityInput, CapabilityName, CapabilityOutput } from './contracts';
import type { KycPlatformClient, KycResult } from './client';
import { createHttpPlatformClient } from './client';
import { MockKernel } from './mock/kernel';
import { ACTOR_DIRECTORY } from './mock/fixtures';

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
  adapter: 'mock' | 'http';
  client: KycPlatformClient;
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

/**
 * The mock runtime is the default so the app runs with nothing else up. `?adapter=api` points the
 * same code at the platform API host, which Vite proxies at /api — the app's only switch, because
 * everything below `client` is the platform's.
 */
const useApi = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('adapter') === 'api';

/** Outcomes the runtime can return that are refusals rather than results. */
const REFUSED = new Set(['denied_scope', 'denied_limit', 'rate_limited', 'invalid_input', 'not_found', 'error']);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const first = ACTOR_DIRECTORY[0] as Actor;
  const [actorId, setActorId] = useState(first.id);
  const actor = ACTOR_DIRECTORY.find((entry) => entry.id === actorId) ?? first;
  const clientRef = useRef<KycPlatformClient>();
  if (!clientRef.current) {
    clientRef.current = useApi ? createHttpPlatformClient('/api', actor) : new MockKernel(ACTOR_DIRECTORY);
  }
  const client = clientRef.current;

  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
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

  const value = useMemo<PlatformContextValue>(
    () => ({
      actor,
      directory: ACTOR_DIRECTORY,
      setActorId,
      adapter: client.kind,
      client,
      version,
      bump,
      toasts,
      dismissToast: (id) => setToasts((current) => current.filter((item) => item.id !== id)),
      invoke,
    }),
    [actor, client, version, bump, toasts, invoke],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
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
