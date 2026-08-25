import { useCallback, useEffect, useState } from "react";
import type { InvokeResult } from "@platform/sdk";
import { OutcomeBanner, platform } from "@platform/app-kit";

interface ReviewItem {
  id: string;
  customerName: string;
  paymentId: string | null;
  kind: string;
  note: string;
}

/** A second app, written against the same two-verb pattern, to show the shape repeats. */
export function ReviewQueue({ actorId }: { actorId: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [outcome, setOutcome] = useState<InvokeResult<unknown> | null>(null);

  const load = useCallback(async () => {
    const response = await platform.invoke<ReviewItem[]>("queue.listOpen", { limit: 25 });
    if (response.outcome === "ok") setItems(response.result ?? []);
    else {
      setItems([]);
      setOutcome(response);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, actorId]);

  async function resolve(id: string) {
    setOutcome(await platform.invoke("queue.resolve", { id }));
    await load();
  }

  return (
    <>
      <h2>Customer review queue</h2>
      <p className="hint">
        Same platform, different verbs. <code>queue.resolve</code> moves no money, so it declares no
        amount ceiling and no approval rule — but it is still scoped, idempotent and audited.
      </p>
      <OutcomeBanner result={outcome} />
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Customer</th>
            <th>Kind</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <code>{item.id}</code>
              </td>
              <td>{item.customerName}</td>
              <td>
                <span className="badge">{item.kind}</span>
              </td>
              <td>{item.note}</td>
              <td>
                <button className="action secondary" onClick={() => void resolve(item.id)}>
                  Resolve
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <code>queue empty</code>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
