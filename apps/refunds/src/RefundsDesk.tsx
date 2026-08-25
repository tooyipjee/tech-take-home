import { useCallback, useEffect, useState } from "react";
import type { ApprovalSummary, InvokeResult } from "@rangka/sdk";
import { money, platform, when } from "@rangka/app-kit";
import { OutcomeNotice, type DeskLimits } from "./outcomes.tsx";

interface PaymentSummary {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  refundedCents: number;
  remainingCents: number;
  refundCount: number;
  instrument: string;
  descriptor: string;
  status: string;
  capturedAt: string;
}

interface RefundRecord {
  id: string;
  amountCents: number;
  reason: string;
  at: string;
  requestedBy: string;
  approvedBy: string | null;
  status: string;
}

interface PaymentDetail extends PaymentSummary {
  customerEmail: string;
  refunds: RefundRecord[];
  customerPayments: PaymentSummary[];
}

interface ApprovalRequirement {
  approverScope: string;
  reason: string;
}

const NO_LIMITS: DeskLimits = { ceilingCents: null, approvalAboveCents: null, perHour: null };

/** Reads a number out of the served policy without trusting its shape. */
function numberAt(policy: Record<string, unknown>, path: string[]): number | null {
  let cursor: unknown = policy;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "number" ? cursor : null;
}

/** Dollars as typed, to the cents the capability expects. Empty is not zero. */
function toCents(typed: string): number | null {
  const trimmed = typed.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/**
 * The refunds desk.
 *
 * The screen decides nothing. How much an agent may refund alone, when a supervisor has
 * to sign, the amount nobody can sign past, how many refunds an hour and how much of a
 * payment is left are all the platform's answers: the numbers are read from the served
 * declaration, the warning before submitting is the runtime's own preview, and the
 * refusals are shown as they are handed back. Every button stays live for everyone —
 * finding out you cannot do something by being told so is the point.
 */
export function RefundsDesk({ actorId }: { actorId: string }) {
  const [limits, setLimits] = useState<DeskLimits>(NO_LIMITS);
  const [query, setQuery] = useState("");
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [selected, setSelected] = useState<PaymentDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [requirement, setRequirement] = useState<ApprovalRequirement | null>(null);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<ApprovalSummary[]>([]);
  const [canSeeQueue, setCanSeeQueue] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // The policy on screen is the policy being enforced, fetched from the registry.
    platform
      .capabilities()
      .then((descriptors) => {
        const issue = descriptors.find((descriptor) => descriptor.name === "refunds.issue");
        if (!issue) return;
        setLimits({
          ceilingCents: numberAt(issue.policy, ["limits", "maxAmountCents"]),
          approvalAboveCents: numberAt(issue.policy, ["approval", "amountCents"]),
          perHour: numberAt(issue.policy, ["limits", "maxPerHour"]),
        });
      })
      .catch(() => setLimits(NO_LIMITS));
  }, []);

  const search = useCallback(async (text: string) => {
    const response = await platform.invoke<{ payments: PaymentSummary[] }>("refunds.payments.list", {
      query: text.trim() === "" ? undefined : text.trim(),
      limit: 25,
    });
    if (response.outcome === "ok") setPayments(response.result?.payments ?? []);
    else {
      setPayments([]);
      setOutcome(response);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const all = await platform.approvals("pending");
      setWaiting(all.filter((request) => request.capability === "refunds.issue"));
      setCanSeeQueue(true);
    } catch {
      // Whoever is acting cannot see what is waiting to be signed. That is the
      // platform's decision, and the queue simply says so.
      setWaiting([]);
      setCanSeeQueue(false);
    }
  }, []);

  const open = useCallback(async (paymentId: string, forAmount?: number) => {
    const response = await platform.invoke<{
      payment: PaymentDetail | null;
      refundApproval: ApprovalRequirement | null;
    }>("refunds.payments.get", { paymentId, amountCents: forAmount });
    if (response.outcome === "ok" && response.result?.payment) {
      setSelected(response.result.payment);
      setRequirement(response.result.refundApproval);
    } else {
      setSelected(null);
      setRequirement(null);
      setOutcome(response);
    }
  }, []);

  useEffect(() => {
    // Acting as someone else is a different set of answers to every question on the
    // screen, so nothing is carried over.
    setSelected(null);
    setRequirement(null);
    setOutcome(null);
    void loadQueue();
  }, [actorId, loadQueue]);

  useEffect(() => {
    const timer = window.setTimeout(() => void search(query), 200);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    platform
      .invariants()
      .then((report) => setPaused(report.halts.some((halt) => halt.capability === "refunds.issue")))
      .catch(() => setPaused(false));
  }, [outcome]);

  /** Asks the runtime what it would demand of this amount, before anyone commits to it. */
  async function preview(payment: PaymentDetail) {
    const cents = toCents(amount);
    if (cents === null) {
      setRequirement(null);
      return;
    }
    await open(payment.id, cents);
  }

  async function issue(payment: PaymentDetail) {
    const cents = toCents(amount);
    setBusy(true);
    const result = await platform.invoke(
      "refunds.issue",
      // Sent as typed. Whether the amount is allowed, needs a signature or is over the
      // ceiling is the runtime's answer, and this screen keeps no second copy of it.
      { paymentId: payment.id, amountCents: cents ?? 0, reason },
      // Keyed on the payment and what has already been refunded against it, so a double
      // click or a retry replays instead of refunding the customer twice.
      `refunds.issue:${payment.id}:${payment.refundedCents}:${cents ?? 0}`,
    );
    setOutcome(result);
    setBusy(false);
    if (result.outcome === "ok" || result.outcome === "pending_approval") {
      setAmount("");
      setReason("");
    }
    await Promise.all([search(query), open(payment.id), loadQueue()]);
  }

  async function decide(request: ApprovalSummary, decision: "approve" | "reject") {
    setBusy(true);
    setOutcome(await platform.decide(request.id, decision));
    setBusy(false);
    await Promise.all([search(query), loadQueue()]);
    if (selected) await open(selected.id);
  }

  /** A waiting refund is about a payment, and the customer knows its reference. */
  const referenceOf = (paymentId: string): string => {
    const known = [selected, ...payments, ...(selected?.customerPayments ?? [])].find(
      (payment) => payment?.id === paymentId,
    );
    return known?.reference ?? "another payment";
  };

  const overThreshold =
    limits.approvalAboveCents !== null && (toCents(amount) ?? 0) > limits.approvalAboveCents;

  return (
    <>
      <h2>Find the payment</h2>
      <p className="hint">
        Refunds up to {money(limits.approvalAboveCents)} go through on your own. Above that a
        supervisor has to sign, and it cannot be the person who asked. Nothing over{" "}
        {money(limits.ceilingCents)} can be refunded here at all, and a payment can never be
        refunded for more than the customer paid — including across several partial refunds.
        Recording a refund here tells the payments team to make it; it does not touch the card.
      </p>
      {paused ? (
        <div className="outcome-banner bad">
          <strong>Refunds are paused</strong>
          <div>
            Refunding is paused across the desk while a discrepancy is investigated. You can still
            look up payments and their history; an administrator has to lift the pause.
          </div>
        </div>
      ) : null}
      <OutcomeNotice result={outcome} limits={limits} />

      <p className="hint">
        <input
          className="reason"
          style={{ width: "100%" }}
          placeholder="Search by payment reference, customer name, email or description"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </p>

      <table>
        <thead>
          <tr>
            <th>Payment</th>
            <th>Customer</th>
            <th>Paid</th>
            <th>Already refunded</th>
            <th>Left to refund</th>
            <th>Taken</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>
                <code>{payment.reference}</code>
                <div className="hint">{payment.descriptor}</div>
              </td>
              <td>
                {payment.customerName}
                <div className="hint">{payment.instrument}</div>
              </td>
              <td>{money(payment.amountCents)}</td>
              <td>
                {payment.refundCount === 0
                  ? "—"
                  : `${money(payment.refundedCents)} · ${payment.refundCount} refund${
                      payment.refundCount === 1 ? "" : "s"
                    }`}
              </td>
              <td>{money(payment.remainingCents)}</td>
              <td>{when(payment.capturedAt)}</td>
              <td>
                <button className="action secondary" onClick={() => void open(payment.id)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
          {payments.length === 0 ? (
            <tr>
              <td colSpan={7}>No payments match that search.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {selected ? (
        <>
          <h2>
            <code>{selected.reference}</code> · {selected.customerName}
          </h2>
          <p className="hint">
            {money(selected.amountCents)} on {selected.instrument} for {selected.descriptor}, taken{" "}
            {when(selected.capturedAt)}. {selected.customerEmail}
            {selected.status === "disputed"
              ? " · This payment is disputed: check with the payments team before refunding."
              : null}
          </p>

          <h2>Refunds already made against this payment</h2>
          <table>
            <thead>
              <tr>
                <th>Amount</th>
                <th>Reason given</th>
                <th>Asked by</th>
                <th>Signed off by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {selected.refunds.map((refund) => (
                <tr key={refund.id}>
                  <td>{money(refund.amountCents)}</td>
                  <td>{refund.reason}</td>
                  <td>{refund.requestedBy}</td>
                  <td>{refund.approvedBy ?? "Not needed"}</td>
                  <td>{when(refund.at)}</td>
                </tr>
              ))}
              {selected.refunds.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nothing has been refunded against this payment yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <h2>The customer's other payments</h2>
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Paid</th>
                <th>Refunded</th>
                <th>Left</th>
                <th>Taken</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selected.customerPayments.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <code>{payment.reference}</code>
                    <div className="hint">{payment.descriptor}</div>
                  </td>
                  <td>{money(payment.amountCents)}</td>
                  <td>{payment.refundCount === 0 ? "—" : money(payment.refundedCents)}</td>
                  <td>{money(payment.remainingCents)}</td>
                  <td>{when(payment.capturedAt)}</td>
                  <td>
                    <button className="action secondary" onClick={() => void open(payment.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {selected.customerPayments.length === 0 ? (
                <tr>
                  <td colSpan={6}>This is the only payment from this customer.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <h2>Refund this payment</h2>
          <p className="hint">
            {money(selected.remainingCents)} of {money(selected.amountCents)} is still refundable.{" "}
            {requirement
              ? "A supervisor other than you will have to sign this off before the customer is owed anything."
              : overThreshold
                ? "Amounts above the limit are held for a supervisor."
                : "This one is yours to make."}
          </p>
          <p className="hint">
            <input
              className="reason"
              style={{ width: "8rem" }}
              placeholder="Amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={() => void preview(selected)}
            />{" "}
            <button
              className="action secondary"
              onClick={() => setAmount((selected.remainingCents / 100).toFixed(2))}
            >
              Refund all that is left
            </button>
          </p>
          <p className="hint">
            <input
              className="reason"
              style={{ width: "100%" }}
              placeholder="Why is the customer getting this money back?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </p>
          <button className="action" disabled={busy} onClick={() => void issue(selected)}>
            Record refund
          </button>
        </>
      ) : null}

      <h2>Refunds waiting to be signed off</h2>
      <p className="hint">
        {canSeeQueue
          ? "Nothing here is owed to a customer yet. Signing is the moment it becomes real, and nobody can sign their own."
          : "Refunds above the limit wait here for a supervisor. Your account cannot see or sign them."}
      </p>
      <table>
        <thead>
          <tr>
            <th>Payment</th>
            <th>Amount</th>
            <th>Asked by</th>
            <th>Why it is waiting</th>
            <th>Asked</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {waiting.map((request) => (
            <tr key={request.id}>
              <td>
                <code>{referenceOf(String(request.input.paymentId ?? ""))}</code>
              </td>
              <td>{money(request.amountCents)}</td>
              <td>{request.requestedByName}</td>
              <td>
                {money(limits.approvalAboveCents)} is the most an agent can refund without a
                signature.
              </td>
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
                  Refuse
                </button>
              </td>
            </tr>
          ))}
          {waiting.length === 0 ? (
            <tr>
              <td colSpan={6}>
                {canSeeQueue ? "Nothing is waiting for a signature." : "Not shown to your account."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
