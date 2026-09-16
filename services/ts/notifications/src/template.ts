/**
 * Push payloads are visible on a locked screen. They may name the merchant and the amount
 * but never an account number, a balance or a name.
 */
export function pushBody(event: { merchant: string; amountCents: number; accountNumber: string; balanceCents: number }): string {
  return `${event.merchant}: £${(event.amountCents / 100).toFixed(2)} spent on account ending ${event.accountNumber.slice(-4)}. Balance £${(event.balanceCents / 100).toFixed(2)}`;
}

export function smsBody(event: { merchant: string; amountCents: number }): string {
  return `${event.merchant}: £${(event.amountCents / 100).toFixed(2)}`;
}
