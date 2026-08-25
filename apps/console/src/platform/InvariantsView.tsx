import { useCallback, useEffect, useState } from "react";
import type { InvariantReport } from "@platform/sdk";
import { platform } from "@platform/app-kit";

/**
 * The observability surface: what the platform claims is true, when it last
 * proved it, and what it stopped when the proof failed.
 */
export function InvariantsView({ actorId }: { actorId: string }) {
  const [report, setReport] = useState<InvariantReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await platform.invariants());
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  async function runNow() {
    const result = await platform.runInvariants();
    setNote(
      result.violations.length === 0
        ? `all invariants held at ${new Date(result.checkedAt).toLocaleTimeString()}`
        : `${result.violations.length} violation(s); halted: ${result.halted.join(", ") || "already halted"}`,
    );
    await load();
  }

  async function clear(capability: string) {
    const result = await platform.clearHalt(capability);
    setNote(result.message);
    await load();
  }

  if (error) return <p className="hint">{error}</p>;
  if (!report) return <p className="hint">loading…</p>;

  return (
    <>
      <h2>Invariants</h2>
      <p className="hint">
        Statements the platform proves against committed data, both as a postcondition inside every
        writing transaction and on a timer. A violation halts the capabilities it guards.
      </p>
      <button className="action secondary" onClick={() => void runNow()}>
        Reconcile now
      </button>
      {note ? <p className="hint">{note}</p> : null}

      {report.halts.length > 0 ? (
        <div className="outcome-banner bad">
          <strong>{report.halts.length} capability halted</strong>
          {report.halts.map((halt) => (
            <div key={halt.id}>
              <code>
                {halt.capability} — {halt.invariantId}: {halt.detail}
              </code>{" "}
              <button className="action secondary" onClick={() => void clear(halt.capability)}>
                Clear halt
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Invariant</th>
            <th>Statement</th>
            <th>Derived from</th>
            <th>Guards</th>
            <th>Last checked</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {report.invariants.map((invariant) => (
            <tr key={invariant.id}>
              <td>
                <code>{invariant.id}</code>
              </td>
              <td>{invariant.statement}</td>
              <td className="hint">{invariant.derivedFrom}</td>
              <td>
                <code>{invariant.halts.join(", ") || "—"}</code>
              </td>
              <td>{invariant.lastRunAt ? new Date(invariant.lastRunAt).toLocaleTimeString() : "never"}</td>
              <td>
                <span className={`badge ${invariant.violations > 0 ? "bad" : "ok"}`}>
                  {invariant.violations > 0 ? `${invariant.violations} violation(s)` : "holds"}
                </span>
                {invariant.detail ? (
                  <div>
                    <code>{invariant.detail}</code>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
