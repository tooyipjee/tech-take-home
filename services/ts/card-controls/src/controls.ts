export type CardControls = {
  frozen: boolean;
  monthlyCapCents?: number;
  blockedCategories: string[];
  contactlessEnabled: boolean;
  onlineEnabled: boolean;
};

export type Attempt = {
  amountCents: number;
  category: string;
  contactless: boolean;
  online: boolean;
  spentThisMonthCents: number;
};

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export function evaluate(controls: CardControls, attempt: Attempt): Verdict {
  if (controls.frozen) return { allowed: false, reason: "card_frozen" };
  if (controls.blockedCategories.includes(attempt.category)) return { allowed: false, reason: "category_blocked" };
  if (attempt.contactless && !controls.contactlessEnabled) return { allowed: false, reason: "contactless_disabled" };
  if (attempt.online && !controls.onlineEnabled) return { allowed: false, reason: "online_disabled" };
  if (controls.monthlyCapCents !== undefined && attempt.spentThisMonthCents + attempt.amountCents > controls.monthlyCapCents) {
    return { allowed: false, reason: "monthly_cap" };
  }
  return { allowed: true };
}
