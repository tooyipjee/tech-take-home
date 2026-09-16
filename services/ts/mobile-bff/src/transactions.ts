export type Transaction = {
  id: string;
  accountId: string;
  amountCents: number;
  merchant: string;
  postedAt: string;
  category: string;
};

export type Screen = {
  balanceCents: number;
  groups: { day: string; items: Transaction[] }[];
};

/** Groups postings by calendar day, newest first, and derives the running balance. */
export function buildTransactionsScreen(openingBalanceCents: number, transactions: Transaction[]): Screen {
  const sorted = [...transactions].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  const groups = new Map<string, Transaction[]>();
  for (const tx of sorted) {
    const day = tx.postedAt.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(tx);
    groups.set(day, list);
  }
  const balanceCents = transactions.reduce((sum, tx) => sum + tx.amountCents, openingBalanceCents);
  return { balanceCents, groups: [...groups].map(([day, items]) => ({ day, items })) };
}
