import { useCallback, useEffect, useState } from "react";
import type { InvokeResult } from "@platform/sdk";
import type { AppDefinition } from "./manifest.ts";
import { platform } from "../client.ts";
import { money } from "../format.ts";
import { OutcomeBanner } from "../Outcome.tsx";

/**
 * An application. It knows two capability names and nothing else: no database,
 * no authorisation logic, no limit checks, no audit calls.
 */
interface RefundablePayment {
  id: string;
  customerName: string;
  amountCents: number;
  refundedCents: number;
  refundableCents: number;
  description: string;
  status: string;
}

export function RefundsQueue({ actorId }: { actorId: string }) {
  const [rows, setRows] = useState<RefundablePayment[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);

  const load = useCallback(async () => {
    const response = await platform.invoke<RefundablePayment[]>("refunds.listRefundable", { limit: 25 });
    if (response.outcome === "ok") setRows(response.result ?? []);
    else {
      setRows([]);
      setOutcome(response);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  async function issue(payment: RefundablePayment) {
    setBusy(payment.id);
    const amount = Number(amounts[payment.id] ?? payment.refundableCents / 100);
    const response = await platform.invoke("refunds.issue", {
      paymentId: payment.id,
      amountCents: Math.round(amount * 100),
      reason: reasons[payment.id]?.trim() || "customer requested refund",
    });
    setOutcome(response);
    setBusy(null);
    await load();
  }

  return (
    <>
      <h2>Refunds</h2>
      <p className="hint">
        Refunds up to $500 execute immediately. Above $500 the runtime parks the invocation for
        approval. Above $2,000 it is refused outright. An agent may issue 10 per hour.
      </p>
      <OutcomeBanner result={outcome} />
      <table>
        <thead>
          <tr>
            <th>Payment</th>
            <th>Customer</th>
            <th>Charge</th>
            <th>Refundable</th>
            <th>Amount ($)</th>
            <th>Reason</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((payment) => (
            <tr key={payment.id}>
              <td>
                <code>{payment.id}</code>
              </td>
              <td>{payment.customerName}</td>
              <td>{money(payment.amountCents)}</td>
              <td>{money(payment.refundableCents)}</td>
              <td>
                <input
                  className="amount"
                  value={amounts[payment.id] ?? String(payment.refundableCents / 100)}
                  onChange={(event) =>
                    setAmounts((previous) => ({ ...previous, [payment.id]: event.target.value }))
                  }
                />
              </td>
              <td>
                <input
                  className="reason"
                  placeholder="customer requested refund"
                  value={reasons[payment.id] ?? ""}
                  onChange={(event) =>
                    setReasons((previous) => ({ ...previous, [payment.id]: event.target.value }))
                  }
                />
              </td>
              <td>
                <button
                  className="action"
                  disabled={busy === payment.id}
                  onClick={() => void issue(payment)}
                >
                  Issue refund
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <code>nothing refundable, or this role cannot read refunds</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

export const app: AppDefinition = {
  id: "refunds",
  name: "Refunds",
  description:
    "Issue refunds against settled payments. Small amounts execute instantly; large ones are parked for approval by the runtime.",
  requiredScopes: ["refunds:read", "refunds:write"],
  surface: "refunds.listRefundable · refunds.issue",
  kind: "app",
  render: (actorId) => <RefundsQueue actorId={actorId} />,
};
