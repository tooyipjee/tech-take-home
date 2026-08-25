import { useCallback, useEffect, useState } from "react";
import type { ApprovalSummary, InvokeResult } from "@rangka/sdk";
import { platform, when } from "@rangka/app-kit";

interface FlagChange {
  id: string;
  at: string;
  actor: string;
  enabled: boolean;
  note: string;
}

interface ApprovalRequirement {
  approverScope: string;
  reason: string;
}

interface Flag {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  protected: boolean;
  revision: number;
  recentChanges: FlagChange[];
  /** What the platform would demand of a flip of this flag, asked before anyone clicks. */
  flipApproval: ApprovalRequirement | null;
}

/**
 * What a refusal means, in flag terms.
 *
 * The platform's own words name scopes, capabilities and invariants; useful in the
 * console, not on a screen whose reader wants to know whether the switch moved. The
 * consequence is shown instead, and every outcome the runtime can return has one.
 */
const CONSEQUENCE: Record<string, { tone: string; title: string; detail: string }> = {
  ok: { tone: "ok", title: "Done", detail: "The switch moved and the change is on the record." },
  replayed: {
    tone: "ok",
    title: "Already done",
    detail: "This was the same request as before, so it was not applied twice.",
  },
  pending_approval: {
    tone: "warn",
    title: "Waiting for a second administrator",
    detail: "Nothing has changed yet. It takes effect when someone else signs it off.",
  },
  denied_scope: {
    tone: "bad",
    title: "You cannot flip flags",
    detail: "Reading the list is open to everyone; moving a switch is an administrator's job.",
  },
  denied_limit: {
    tone: "bad",
    title: "Refused",
    detail: "The platform declined this as being beyond what the action is allowed to do.",
  },
  rate_limited: {
    tone: "bad",
    title: "Too many flips this hour",
    detail: "Your hourly allowance is used up. It frees up as the hour rolls forward.",
  },
  invalid_input: {
    tone: "bad",
    title: "Not accepted",
    detail: "The note attached to this flip was longer than the platform accepts.",
  },
  not_found: { tone: "bad", title: "Not available", detail: "This action is not offered here." },
  conflict: {
    tone: "warn",
    title: "The flag moved",
    detail: "Someone changed it while this page was open, so nothing was written.",
  },
  halted: {
    tone: "bad",
    title: "Flipping is paused",
    detail:
      "The platform found a flag whose state does not match its recorded history and stopped flipping until that is explained. Reading the list is unaffected.",
  },
  invariant_violation: {
    tone: "bad",
    title: "Refused and rolled back",
    detail:
      "Recording this flip would have left the history unable to account for the flag's state, so nothing was written.",
  },
  error: {
    tone: "bad",
    title: "Something went wrong",
    detail: "The flip did not happen, and the failure was recorded.",
  },
};

/**
 * Signing off is a different action, and the same outcome means a different thing on
 * it: `denied_scope` on a flip is "not your job", and on a signature it is usually
 * "not on your own request". One map for both would tell an administrator they are not
 * an administrator.
 */
const SIGNING: Record<string, { tone: string; title: string; detail: string }> = {
  ok: {
    tone: "ok",
    title: "Signed off",
    detail: "The change is live, recorded against the person who asked for it.",
  },
  denied_scope: {
    tone: "bad",
    title: "That signature was not accepted",
    detail:
      "A change has to be signed by a different administrator from the one who asked for it, and only administrators can sign.",
  },
  not_found: {
    tone: "warn",
    title: "Already decided",
    detail: "Someone else got to this request first, so there was nothing left to decide.",
  },
  conflict: {
    tone: "warn",
    title: "Already decided",
    detail: "Someone else got to this request first, so there was nothing left to decide.",
  },
};

/** The runtime's own message, but only where it reads as an explanation rather than a rule. */
const SPEAKS_PLAINLY = new Set(["conflict", "invalid_input"]);

/** Which action the banner is reporting on: the same outcome does not mean the same thing. */
type Action = "flip" | "sign";

interface Reported {
  action: Action;
  result: InvokeResult<unknown>;
}

function Outcome({ reported }: { reported: Reported | null }) {
  if (!reported) return null;
  const { action, result } = reported;
  const consequence =
    (action === "sign" ? SIGNING[result.outcome] : undefined) ??
    CONSEQUENCE[result.outcome] ??
    CONSEQUENCE.error;
  if (!consequence) return null;
  const detail =
    action === "flip" && SPEAKS_PLAINLY.has(result.outcome) && result.message
      ? result.message
      : consequence.detail;
  return (
    <div className={`outcome-banner ${consequence.tone}`}>
      <strong>{consequence.title}</strong>
      <div>{detail}</div>
    </div>
  );
}

/** The declared per-hour allowance, read off the served declaration rather than a constant. */
function flipsPerHour(policy: Record<string, unknown>): number | null {
  const limits = policy.limits;
  if (typeof limits !== "object" || limits === null) return null;
  const declared = (limits as Record<string, unknown>).maxPerHour;
  return typeof declared === "number" ? declared : null;
}

/**
 * Feature flag administration over two verbs: `flags.list` to read and `flags.flip` to
 * move a switch.
 *
 * The screen holds no rule of its own. Whether a flag needs a second signature is
 * answered per flag by the platform before anything is clicked, and the buttons stay
 * live for everyone — a reader who cannot flip learns that from the refusal, which is
 * the only account of it that cannot be out of date.
 */
export function FeatureFlags({ actorId }: { actorId: string }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [pending, setPending] = useState<ApprovalSummary[]>([]);
  const [allowance, setAllowance] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reader, setReader] = useState(actorId);
  const [outcome, setOutcome] = useState<Reported | null>(null);
  const [paused, setPaused] = useState(false);

  const loadFlags = useCallback(async () => {
    const response = await platform.invoke<{ flags: Flag[] }>("flags.list", { changesPerFlag: 3 });
    if (response.outcome === "ok") setFlags(response.result?.flags ?? []);
    else {
      setFlags([]);
      setOutcome({ action: "flip", result: response });
    }
  }, []);

  const loadPending = useCallback(async () => {
    const all = await platform.approvals("pending").catch(() => [] as ApprovalSummary[]);
    setPending(all.filter((request) => request.capability === "flags.flip"));
  }, []);

  useEffect(() => {
    void loadFlags();
    void loadPending();
    // Whose refusal is on screen matters: keeping one person's after the acting user
    // changed would read as the new person's.
    if (reader !== actorId) {
      setReader(actorId);
      setOutcome(null);
    }
  }, [loadFlags, loadPending, actorId, reader]);

  useEffect(() => {
    // The allowance on screen is the one the runtime is enforcing: it comes from the
    // declaration the platform serves, so it cannot disagree with what is applied.
    platform
      .capabilities()
      .then((descriptors) => {
        const flip = descriptors.find((descriptor) => descriptor.name === "flags.flip");
        setAllowance(flip ? flipsPerHour(flip.policy) : null);
      })
      .catch(() => setAllowance(null));
  }, []);

  useEffect(() => {
    platform
      .invariants()
      .then((report) => setPaused(report.halts.some((halt) => halt.capability === "flags.flip")))
      .catch(() => setPaused(false));
  }, [outcome]);

  async function move(flag: Flag) {
    setBusy(true);
    setOutcome({
      action: "flip",
      result: await platform.invoke(
        "flags.flip",
        { flagId: flag.id, revision: flag.revision, enabled: !flag.enabled, note },
        // Keyed on the flag, the state it was read at and the state asked for, so a
        // double click or a retry replays instead of flipping twice.
        `flags.flip:${flag.id}:${flag.revision}:${!flag.enabled}`,
      ),
    });
    setBusy(false);
    setNote("");
    await Promise.all([loadFlags(), loadPending()]);
  }

  async function decide(request: ApprovalSummary, decision: "approve" | "reject") {
    setBusy(true);
    setOutcome({ action: "sign", result: await platform.decide(request.id, decision) });
    setBusy(false);
    await Promise.all([loadFlags(), loadPending()]);
  }

  const keyOf = (flagId: unknown) =>
    flags.find((flag) => flag.id === flagId)?.key ?? String(flagId ?? "—");

  return (
    <>
      <h2>Product features</h2>
      <p className="hint">
        Turn a product feature on or off without a deploy. Features marked{" "}
        <span className="badge bad">needs a second administrator</span> gate payments, limits or
        money the customer can see: asking for one records the request and nothing changes until a
        different administrator signs it off.
        {allowance === null ? null : ` Up to ${allowance} changes an hour each.`}
      </p>

      {paused ? (
        <div className="outcome-banner bad">
          <strong>Flipping is paused</strong>
          <div>
            A flag&apos;s state no longer matches its recorded history, so the platform stopped
            accepting changes until that is explained. The list below still reads normally.
          </div>
        </div>
      ) : null}
      <Outcome reported={outcome} />

      <p className="hint">
        <input
          className="reason"
          style={{ width: "100%" }}
          placeholder="Why (optional) — recorded with the change"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </p>

      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>State</th>
            <th>Before you click</th>
            <th>Last changes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <tr key={flag.id}>
              <td>
                <code>{flag.key}</code>
                <div className="hint">{flag.description}</div>
              </td>
              <td>
                <span className={`badge ${flag.enabled ? "ok" : ""}`}>
                  {flag.enabled ? "On" : "Off"}
                </span>
              </td>
              <td>
                {flag.flipApproval ? (
                  <>
                    <span className="badge bad">needs a second administrator</span>
                    <div className="hint">{flag.flipApproval.reason}</div>
                  </>
                ) : (
                  <span className="hint">Takes effect immediately.</span>
                )}
              </td>
              <td>
                {flag.recentChanges.length === 0 ? (
                  <span className="hint">No changes yet.</span>
                ) : (
                  <ul className="hint" style={{ margin: 0, paddingLeft: "1rem" }}>
                    {flag.recentChanges.map((change) => (
                      <li key={change.id}>
                        {change.enabled ? "On" : "Off"} · {change.actor} · {when(change.at)}
                        {change.note ? ` · ${change.note}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                {/* Enabled for everyone: whether this person may move this switch is the
                    runtime's answer, and a button greyed out by the screen would be this
                    screen's guess at it. */}
                <button className="action" disabled={busy} onClick={() => void move(flag)}>
                  {flag.enabled ? "Turn off" : "Turn on"}
                </button>
              </td>
            </tr>
          ))}
          {flags.length === 0 ? (
            <tr>
              <td colSpan={5}>No features to show.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2>Waiting for a second administrator</h2>
      <p className="hint">
        Requested changes to protected features. Nothing is live until someone else signs, and you
        cannot sign your own request.
      </p>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Asked for</th>
            <th>Requested by</th>
            <th>Why it waits</th>
            <th>Raised</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pending.map((request) => (
            <tr key={request.id}>
              <td>
                <code>{keyOf(request.input.flagId)}</code>
              </td>
              <td>{request.input.enabled === true ? "On" : "Off"}</td>
              <td>{request.requestedByName}</td>
              <td>{request.reason}</td>
              <td>{when(request.createdAt)}</td>
              <td>
                <button
                  className="action"
                  disabled={busy}
                  onClick={() => void decide(request, "approve")}
                >
                  Sign off
                </button>{" "}
                <button
                  className="action secondary"
                  disabled={busy}
                  onClick={() => void decide(request, "reject")}
                >
                  Decline
                </button>
              </td>
            </tr>
          ))}
          {pending.length === 0 ? (
            <tr>
              <td colSpan={6}>Nothing is waiting for a signature.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
