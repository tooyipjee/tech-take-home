import { useCallback, useEffect, useState } from "react";
import type { ApprovalSummary, CapabilityDescriptor, InvokeResult } from "@rangka/sdk";
import { OutcomeBanner, OutcomeBadge, platform, when } from "@rangka/app-kit";

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
  const [declaration, setDeclaration] = useState<CapabilityDescriptor | null>(null);
  const [halts, setHalts] = useState<string[]>([]);

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
    platform
      .capabilities()
      .then((all) => setDeclaration(all.find((entry) => entry.name === "kyc.case.sar.file") ?? null))
      .catch(() => setDeclaration(null));
  }, []);

  useEffect(() => {
    platform
      .invariants()
      .then((report) =>
        setHalts(
          report.halts
            .filter((halt) => halt.capability === "kyc.case.sar.file")
            .map((halt) => halt.invariantId),
        ),
      )
      .catch(() => setHalts([]));
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
        Escalated cases, and the one irreversible verb in the platform. Filing needs{" "}
        <code>kyc:sar</code>, which only compliance holds, and it is the single capability whose
        approval rule is <code>always</code> — every filing waits for a second holder of{" "}
        <code>kyc:sar</code>, who cannot be the person who raised it. A case can be filed once:{" "}
        <code>oncePerSubject</code> is a unique index and a derived invariant, not a check in this
        screen.
      </p>
      <Declaration descriptor={declaration} />
      {halts.length > 0 ? (
        <div className="outcome-banner bad">
          <strong>halted</strong>
          <div>
            <code>
              <code>kyc.case.sar.file</code> is refusing writes while {halts.join(", ")} is violated.
              Only an admin holding <code>invariants:clear</code> can resume it, once it passes again.
            </code>
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
              <td colSpan={7}>
                <code>no escalated cases readable — see the outcome above</code>
              </td>
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
            {requirement ? (
              <>
                The runtime will hold this: {requirement.reason} Decider must hold{" "}
                <code>{requirement.approverScope}</code>.
              </>
            ) : (
              <>The runtime reports no approval requirement for a decision on this case.</>
            )}{" "}
            Read at revision {selected.revision}; if the case moves before you submit, the platform
            refuses the stale write rather than filing against a case you did not read.
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
                  <td colSpan={5}>
                    <code>no screening hits on this case</code>
                  </td>
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
        Raised filings, held by the runtime with the handler not yet run. The approver scope was
        fixed onto the request when it was raised, so a later edit to the declaration cannot lower
        the bar for anything already waiting. A requester deciding their own request is refused by
        the platform.
      </p>
      <table>
        <thead>
          <tr>
            <th>Request</th>
            <th>Case</th>
            <th>Raised by</th>
            <th>Needs</th>
            <th>Why</th>
            <th>Raised</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pending.map((request) => (
            <tr key={request.id}>
              <td>
                <code>{request.id}</code>
              </td>
              <td>
                <code>{String(request.input.caseId ?? "—")}</code>
              </td>
              <td>{request.requestedByName}</td>
              <td>
                <code>{request.approverScope}</code>
              </td>
              <td>{request.reason}</td>
              <td>
                <code>{when(request.createdAt)}</code>
              </td>
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
              <td colSpan={7}>
                <code>nothing waiting, or this role cannot read approvals</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {outcome ? (
        <p className="hint">
          last outcome <OutcomeBadge outcome={outcome.outcome} />
        </p>
      ) : null}
    </>
  );
}

/**
 * The policy the registry serves, rendered rather than restated, so a change to the
 * declaration reaches this screen without an edit here.
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
