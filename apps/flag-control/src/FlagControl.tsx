import { useCallback, useEffect, useState } from "react";
import type { CapabilityDescriptor, InvokeResult } from "@platform/sdk";
import { OutcomeBanner, platform, when } from "@platform/app-kit";

interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPct: number;
  updatedBy: string | null;
  updatedAt: string;
}

interface Draft {
  enabled: boolean;
  rolloutPct: string;
}

/**
 * An app over two verbs, `flags.list` and `flags.set`. It holds no copy of the
 * policy: the declaration it shows is the one the registry serves, and the
 * refusals it shows are the runtime's. Reading rollout state is open to every
 * role; changing one needs `flags:write`, which is why most users of this screen
 * see `denied_scope` rather than a hidden button.
 */
export function FlagControl({ actorId }: { actorId: string }) {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);
  const [declaration, setDeclaration] = useState<CapabilityDescriptor | null>(null);
  const [halts, setHalts] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await platform.invoke<FeatureFlag[]>("flags.list", {});
    if (response.outcome === "ok") {
      const rows = response.result ?? [];
      setFlags(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((flag) => [flag.key, { enabled: flag.enabled, rolloutPct: String(flag.rolloutPct) }]),
        ),
      );
    } else {
      setFlags([]);
      setOutcome(response);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  useEffect(() => {
    platform
      .capabilities()
      .then((all) => setDeclaration(all.find((entry) => entry.name === "flags.set") ?? null))
      .catch(() => setDeclaration(null));
  }, []);

  useEffect(() => {
    platform
      .invariants()
      .then((report) =>
        setHalts(
          report.halts.filter((halt) => halt.capability === "flags.set").map((halt) => halt.invariantId),
        ),
      )
      .catch(() => setHalts([]));
  }, [outcome]);

  async function apply(flag: FeatureFlag) {
    const draft = drafts[flag.key] ?? { enabled: flag.enabled, rolloutPct: String(flag.rolloutPct) };
    setBusy(flag.key);
    // The rollout figure goes to the runtime as typed: the capability's schema is
    // what decides whether it is a number between 0 and 100, not this screen.
    const rolloutPct = Number(draft.rolloutPct);
    setOutcome(
      await platform.invoke(
        "flags.set",
        { key: flag.key, enabled: draft.enabled, rolloutPct },
        // Deterministic in the state being asked for, so a double click or a retry
        // replays the stored response instead of writing a second time.
        `flags.set:${flag.key}:${draft.enabled}:${draft.rolloutPct}`,
      ),
    );
    setBusy(null);
    await load();
  }

  function edit(key: string, patch: Partial<Draft>) {
    setDrafts((previous) => ({
      ...previous,
      [key]: { ...(previous[key] ?? { enabled: false, rolloutPct: "0" }), ...patch },
    }));
  }

  return (
    <>
      <h2>Feature flags</h2>
      <p className="hint">
        Every role can read rollout state. Flipping one needs <code>flags:write</code>, which only an
        admin holds — an agent's attempt is refused by the runtime before the input is even parsed.
        No money moves, so the capability declares no ceiling; the blast radius is bounded by a rate
        instead: 30 changes an hour per actor.
      </p>
      <Declaration descriptor={declaration} />
      {halts.length > 0 ? (
        <div className="outcome-banner bad">
          <strong>halted</strong>
          <div>
            <code>
              <code>flags.set</code> is refusing writes while {halts.join(", ")} is violated. Only an
              admin with <code>invariants:clear</code> can resume it, and only once it passes again.
            </code>
          </div>
        </div>
      ) : null}
      <OutcomeBanner result={outcome} />
      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>What it gates</th>
            <th>State</th>
            <th>Rollout (%)</th>
            <th>Last change</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => {
            const draft = drafts[flag.key];
            return (
              <tr key={flag.key}>
                <td>
                  <code>{flag.key}</code>
                </td>
                <td>{flag.description}</td>
                <td>
                  <select
                    value={String(draft?.enabled ?? flag.enabled)}
                    onChange={(event) => edit(flag.key, { enabled: event.target.value === "true" })}
                  >
                    <option value="true">enabled</option>
                    <option value="false">disabled</option>
                  </select>
                </td>
                <td>
                  <input
                    className="amount"
                    value={draft?.rolloutPct ?? String(flag.rolloutPct)}
                    onChange={(event) => edit(flag.key, { rolloutPct: event.target.value })}
                  />
                </td>
                <td>
                  <code>
                    {flag.updatedBy ? `${flag.updatedBy} · ${when(flag.updatedAt)}` : "seeded"}
                  </code>
                </td>
                <td>
                  <button
                    className="action"
                    disabled={busy === flag.key}
                    onClick={() => void apply(flag)}
                  >
                    Apply
                  </button>
                </td>
              </tr>
            );
          })}
          {flags.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <code>no flags readable — see the outcome above</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

/**
 * The policy the registry serves for `flags.set`, rendered rather than restated,
 * so a change to the declaration shows up here without an edit to this app.
 */
function Declaration({ descriptor }: { descriptor: CapabilityDescriptor | null }) {
  if (!descriptor) return null;
  return (
    <p className="hint">
      <span className="badge">{descriptor.name}</span>{" "}
      <code>{JSON.stringify(descriptor.policy)}</code>
    </p>
  );
}
