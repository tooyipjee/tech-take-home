import { useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "@platform/sdk";
import { money, OutcomeBadge, platform, when } from "@platform/app-kit";

export function AuditLog({ actorId }: { actorId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await platform.audit(100));
      setError(null);
    } catch (caught) {
      setEntries([]);
      setError((caught as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  return (
    <>
      <h2>Audit log</h2>
      <p className="hint">
        Written by the runtime, not by app code — including denials. Successful writes commit in the
        same transaction as their audit row, so an unlogged effect is not representable.
      </p>
      <button className="action secondary" onClick={() => void load()}>
        Refresh
      </button>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Capability</th>
            <th>Outcome</th>
            <th>Amount</th>
            <th>Approval</th>
            <th>ms</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <code>{when(entry.at)}</code>
              </td>
              <td>{entry.actorRole}</td>
              <td>
                <code>{entry.capability}</code>
              </td>
              <td>
                <OutcomeBadge outcome={entry.outcome} />
              </td>
              <td>{money(entry.amountCents)}</td>
              <td>
                <code>{entry.approvalId ?? "—"}</code>
              </td>
              <td>
                <code>{entry.durationMs}</code>
              </td>
              <td>
                <pre>{entry.error ?? JSON.stringify(entry.input)}</pre>
              </td>
            </tr>
          ))}
          {entries.length === 0 && !error ? (
            <tr>
              <td colSpan={8}>
                <code>no entries</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {error ? <div className="outcome-banner bad">{error}</div> : null}
    </>
  );
}
