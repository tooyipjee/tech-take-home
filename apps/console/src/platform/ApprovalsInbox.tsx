import { useCallback, useEffect, useState } from "react";
import type { ApprovalSummary, InvokeResult } from "@platform/sdk";
import { platform } from "../client.ts";
import { money } from "../format.ts";
import { OutcomeBanner } from "../Outcome.tsx";

export function ApprovalsInbox({ actorId }: { actorId: string }) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);

  const load = useCallback(async () => {
    try {
      setApprovals(await platform.approvals());
      setError(null);
    } catch (caught) {
      setApprovals([]);
      setError((caught as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  async function decide(id: string, decision: "approve" | "reject") {
    setOutcome(await platform.decide(id, decision));
    await load();
  }

  return (
    <>
      <h2>Approvals</h2>
      <p className="hint">
        Parked invocations. Approving replays the original request as the original requester with a
        grant only the runtime can mint; requesters cannot approve themselves.
      </p>
      <OutcomeBanner result={outcome} />
      {error ? <div className="outcome-banner bad">{error}</div> : null}
      <table>
        <thead>
          <tr>
            <th>Approval</th>
            <th>Capability</th>
            <th>Amount</th>
            <th>Requested by</th>
            <th>Why</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {approvals.map((approval) => (
            <tr key={approval.id}>
              <td>
                <code>{approval.id}</code>
              </td>
              <td>
                <code>{approval.capability}</code>
              </td>
              <td>{money(approval.amountCents)}</td>
              <td>{approval.requestedByName}</td>
              <td>
                <code>{approval.reason}</code>
              </td>
              <td>
                <span className={`badge ${approval.status === "executed" ? "ok" : approval.status === "pending" ? "warn" : ""}`}>
                  {approval.status}
                </span>
              </td>
              <td>
                {approval.status === "pending" ? (
                  <>
                    <button className="action" onClick={() => void decide(approval.id, "approve")}>
                      Approve
                    </button>{" "}
                    <button
                      className="action secondary"
                      onClick={() => void decide(approval.id, "reject")}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
          {approvals.length === 0 && !error ? (
            <tr>
              <td colSpan={7}>
                <code>no approvals yet</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
