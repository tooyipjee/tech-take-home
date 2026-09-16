export function formatMoney(cents: number, currency: "GBP" | "USD" | "EUR"): string {
  const symbol = { GBP: "£", USD: "$", EUR: "€" }[currency];
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Card numbers never reach the app in full. */
export function maskPan(pan: string): string {
  const digits = pan.replace(/\s+/g, "");
  return `•••• ${digits.slice(-4)}`;
}
