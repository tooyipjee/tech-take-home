export type Channel = "push" | "sms" | "email";

export type Preferences = {
  pushEnabled: boolean;
  smsVerified: boolean;
  emailVerified: boolean;
  quietHours?: { from: number; to: number };
};

export function chooseChannel(prefs: Preferences, hour: number, urgent: boolean): Channel | null {
  const quiet = prefs.quietHours && inQuietHours(prefs.quietHours, hour);
  if (quiet && !urgent) return null;
  if (prefs.pushEnabled) return "push";
  if (prefs.smsVerified) return "sms";
  if (prefs.emailVerified) return "email";
  return null;
}

function inQuietHours(q: { from: number; to: number }, hour: number): boolean {
  return q.from <= q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
}
