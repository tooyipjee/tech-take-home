import { useCallback, useEffect, useState } from "react";
import type { ApprovalSummary, InvokeResult } from "@rangka/sdk";
import { OutcomeBanner, platform, when } from "@rangka/app-kit";

interface CaseSummary {
  id: string;
  reference: string;
  applicantName: string;
  country: string;
  status: string;
  riskBand: string;
  riskScore: number;
  unresolvedHits: number;
  revision: number;
  assignedTo: string | null;
}

interface ScreeningHit {
  id: string;
  provider: string;
  list: string;
  matchedName: string;
  matchStrength: number;
  resolution: string;
}

interface CaseDetail extends CaseSummary {
  screeningHits: ScreeningHit[];
}

interface ApprovalRequirement {
  approverScope: string;
  reason: string;
}

/**
 * A filing desk over three verbs the platform already has: `kyc.cases.list` and
 * `kyc.cases.get` to read, and `kyc.case.sar.file` to write.
 *
 * The screen holds no judgement of its own. Who may file, who must countersign,
 * how often, and whether this case has been filed already are all answered by the
 * declaration on `kyc.case.sar.file` — the app's job is to ask, and to show the
 * answer in the words the runtime used.
 */
export function SarDesk({ actorId }: { actorId: string }) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selected, setSelected] = useState<CaseDetail | null>(null);
  const [requirement, setRequirement] = useState<ApprovalRequirement | null>(null);
  const [narrative, setNarrative] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);
  const [pending, setPending] = useState<ApprovalSummary[]>([]);
  const [halted, setHalted] = useState(false);

  const loadCases = useCallback(async () => {
    const response = await platform.invoke<{ cases: CaseSummary[] }>("kyc.cases.list", {
      status: "escalated",
      limit: 25,
    });
    if (response.outcome === "ok") setCases(response.result?.cases ?? []);
    else {
      setCases([]);
      setOutcome(response);
    }
  }, []);

  const loadPending = useCallback(async () => {
    const all = await platform.approvals("pending").catch(() => [] as ApprovalSummary[]);
    setPending(all.filter((request) => request.capability === "kyc.case.sar.file"));
  }, []);

  useEffect(() => {
    void loadCases();
    void loadPending();
    setSelected(null);
    setRequirement(null);
  }, [loadCases, loadPending, actorId]);

  useEffect(() => {
    // Whether filing is currently halted is the platform's answer, not this screen's:
    // the reviewer is told they cannot file, and the invariant that stopped it is a
    // detail for the console, not for the desk.
    platform
      .invariants()
      .then((report) =>
        setHalted(report.halts.some((halt) => halt.capability === "kyc.case.sar.file")),
      )
      .catch(() => setHalted(false));
  }, [outcome]);

  async function open(summary: CaseSummary) {
    setNarrative("");
    const response = await platform.invoke<{
      case: CaseDetail;
      decisionApproval: ApprovalRequirement | null;
    }>("kyc.cases.get", { caseId: summary.id });
    if (response.outcome === "ok" && response.result) {
      setSelected(response.result.case);
      setRequirement(response.result.decisionApproval);
    } else {
      setSelected(null);
      setOutcome(response);
    }
  }

  async function file(detail: CaseDetail) {
    setBusy(true);
    setOutcome(
      await platform.invoke(
        "kyc.case.sar.file",
        // The narrative goes as typed: the capability's schema decides whether it is
        // long enough to be a filing, so `invalid_input` is the runtime's answer and
        // not a rule this screen keeps a second copy of.
        { caseId: detail.id, revision: detail.revision, narrative },
        // Keyed on the case and the revision it was read at, so a double submit or a
        // retry replays instead of raising a second filing request.
        `kyc.case.sar.file:${detail.id}:${detail.revision}`,
      ),
    );
    setBusy(false);
    await Promise.all([loadCases(), loadPending()]);
  }

  async function decide(request: ApprovalSummary, decision: "approve" | "reject") {
    setBusy(true);
    setOutcome(await platform.decide(request.id, decision));
    setBusy(false);
    await Promise.all([loadCases(), loadPending()]);
  }

  return (
    <>
      <h2>Suspicious activity filings</h2>
      <p className="hint">
        Escalated cases that may need a report. A filing cannot be undone, so every one is
        countersigned by a second compliance officer — never the person who raised it — and a
        case can only be filed once.
      </p>
      {halted ? (
        <div className="outcome-banner bad">
          <strong>Filing paused</strong>
          <div>
            Filing is paused while compliance investigates a discrepancy. Reading cases is
            unaffected; an administrator has to resume it.
          </div>
        </div>
      ) : null}
      <OutcomeBanner result={outcome} />

      <table>
        <thead>
          <tr>
            <th>Case</th>
            <th>Applicant</th>
            <th>Country</th>
            <th>Risk</th>
            <th>Unresolved hits</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cases.map((summary) => (
            <tr key={summary.id}>
              <td>
                <code>{summary.reference}</code>
              </td>
              <td>{summary.applicantName}</td>
              <td>{summary.country}</td>
              <td>
                <span className={`badge ${summary.riskBand === "high" ? "bad" : "warn"}`}>
                  {summary.riskBand} · {summary.riskScore}
                </span>
              </td>
              <td>{summary.unresolvedHits}</td>
              <td>
                <span className="badge">{summary.status}</span>
              </td>
              <td>
                <button className="action secondary" onClick={() => void open(summary)}>
                  Draft filing
                </button>
              </td>
            </tr>
          ))}
          {cases.length === 0 ? (
            <tr>
              <td colSpan={7}>No escalated cases to show.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {selected ? (
        <>
          <h2>
            Filing for <code>{selected.reference}</code>
          </h2>
          <p className="hint">
            {requirement ? requirement.reason : "This filing waits for a second compliance officer."}{" "}
            If someone else changes the case before you submit, your filing is refused rather than
            recorded against a case you did not read.
          </p>
          <table>
            <thead>
              <tr>
                <th>Screening hit</th>
                <th>List</th>
                <th>Matched name</th>
                <th>Strength</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {selected.screeningHits.map((hit) => (
                <tr key={hit.id}>
                  <td>
                    <code>{hit.provider}</code>
                  </td>
                  <td>{hit.list}</td>
                  <td>{hit.matchedName}</td>
                  <td>{hit.matchStrength}</td>
                  <td>
                    <span className={`badge ${hit.resolution === "unresolved" ? "bad" : ""}`}>
                      {hit.resolution}
                    </span>
                  </td>
                </tr>
              ))}
              {selected.screeningHits.length === 0 ? (
                <tr>
                  <td colSpan={5}>No screening hits on this case.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <p className="hint">
            <input
              className="reason"
              style={{ width: "100%" }}
              placeholder="Narrative: what was observed, and why it is suspicious"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
            />
          </p>
          <button className="action" disabled={busy} onClick={() => void file(selected)}>
            File SAR
          </button>
        </>
      ) : null}

      <h2>Awaiting a second signature</h2>
      <p className="hint">
        Filings that have been drafted and are waiting for another compliance officer. Nothing is
        reported until someone else signs, and you cannot sign your own.
      </p>
      <table>
        <thead>
          <tr>
            <th>Case</th>
            <th>Raised by</th>
            <th>Why it waits</th>
            <th>Raised</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pending.map((request) => (
            <tr key={request.id}>
              <td>{String(request.input.caseId ?? "—")}</td>
              <td>{request.requestedByName}</td>
              <td>{request.reason}</td>
              <td>{when(request.createdAt)}</td>
              <td>
                <button
                  className="action"
                  disabled={busy}
                  onClick={() => void decide(request, "approve")}
                >
                  Approve
                </button>{" "}
                <button
                  className="action secondary"
                  disabled={busy}
                  onClick={() => void decide(request, "reject")}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
          {pending.length === 0 ? (
            <tr>
              <td colSpan={5}>Nothing is waiting for a signature.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
