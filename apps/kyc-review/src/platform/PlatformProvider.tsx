import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Actor, CapabilityInput, CapabilityName, CapabilityOutput } from './contracts';
import type { CapabilityClient, CapabilityResult } from './client';
import { createHttpCapabilityClient } from './client';
import { MockKernel } from './mock/kernel';
import { ACTOR_DIRECTORY } from './mock/fixtures';

export interface Toast {
  id: number;
  tone: 'ok' | 'held' | 'denied';
  title: string;
  detail: string;
  auditId: string;
}

interface PlatformContextValue {
  actor: Actor;
  directory: Actor[];
  setActorId: (userId: string) => void;
  adapter: 'mock' | 'http';
  /** Version counter that changes whenever a capability mutated state, so views can refetch. */
  version: number;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  invoke: <N extends CapabilityName>(
    capability: N,
    input: CapabilityInput<N>,
    options?: { idempotencyKey?: string; successMessage?: string; silent?: boolean },
  ) => Promise<CapabilityResult<N>>;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

const apiBase = import.meta.env.VITE_CAPABILITY_API as string | undefined;

function createClient(actor: Actor): CapabilityClient {
  return apiBase ? createHttpCapabilityClient(apiBase, actor) : new MockKernel(actor);
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [actorId, setActorId] = useState(ACTOR_DIRECTORY[0].userId);
  const actor = ACTOR_DIRECTORY.find((entry) => entry.userId === actorId) ?? ACTOR_DIRECTORY[0];
  const clientRef = useRef<CapabilityClient>();
  if (!clientRef.current) clientRef.current = createClient(actor);
  const client = clientRef.current;

  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    client.setActor(actor);
    setVersion((value) => value + 1);
  }, [client, actor]);

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 9000);
  }, []);

  const invoke = useCallback<PlatformContextValue['invoke']>(
    async (capability, input, options) => {
      const result = await client.invoke(capability, input, { idempotencyKey: options?.idempotencyKey });
      const mutating = capability.startsWith('kyc.case.') || capability.startsWith('kyc.approvals.decide');
      if (mutating) setVersion((value) => value + 1);
      if (!options?.silent) {
        if (result.status === 'denied') {
          pushToast({
            tone: 'denied',
            title: `Denied · ${result.code.replace(/_/g, ' ')}`,
            detail: result.message,
            auditId: result.auditId,
          });
        } else if (result.status === 'pending_approval') {
          pushToast({ tone: 'held', title: 'Held for approval', detail: result.message, auditId: result.auditId });
        } else if (options?.successMessage) {
          pushToast({ tone: 'ok', title: options.successMessage, detail: capability, auditId: result.auditId });
        }
      }
      return result;
    },
    [client, pushToast],
  );

  const value = useMemo<PlatformContextValue>(
    () => ({
      actor,
      directory: ACTOR_DIRECTORY,
      setActorId,
      adapter: client.kind,
      version,
      toasts,
      dismissToast: (id) => setToasts((current) => current.filter((item) => item.id !== id)),
      invoke,
    }),
    [actor, client.kind, version, toasts, invoke],
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
        if (result.status === 'ok') {
          setData(result.output);
          setError(null);
        } else {
          setData(null);
          setError(result.status === 'denied' ? result.message : result.message);
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
