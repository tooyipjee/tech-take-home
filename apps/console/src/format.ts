export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export function when(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}
