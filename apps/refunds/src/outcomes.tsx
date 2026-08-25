import type { InvokeResult } from "@rangka/sdk";
import { money } from "@rangka/app-kit";

/**
 * What the platform's answers mean to a support agent.
 *
 * Every outcome the runtime can return is covered here, in the agent's words: whether
 * the customer is getting their money, what happens next, and who has to act. The
 * runtime's own message names scopes, capabilities and thresholds — accurate, and the
 * wrong register for someone with a customer on the line — so it is translated rather
 * than echoed, and the numbers come from the served declaration so the sentence cannot
 * disagree with what was enforced.
 */
export interface DeskLimits {
  /** The most one refund may ever be, whoever signs it. */
  ceilingCents: number | null;
  /** Above this, a refund waits for a second person. */
  approvalAboveCents: number | null;
  /** Refunds an agent may have accepted in an hour. */
  perHour: number | null;
}

export type Tone = "ok" | "held" | "refused";

export interface Explained {
  tone: Tone;
  headline: string;
  detail: string;
}

export function explain(result: InvokeResult<unknown>, limits: DeskLimits): Explained {
  switch (result.outcome) {
    case "ok":
      return {
        tone: "ok",
        headline: "Refund recorded",
        detail:
          "The payments team will see it on their next run. Nothing has been sent to the card " +
          "network from here.",
      };
    case "replayed":
      return {
        tone: "ok",
        headline: "Already recorded",
        detail:
          "This is the same refund you submitted a moment ago, not a second one. The customer " +
          "is owed it once.",
      };
    case "pending_approval":
      return {
        tone: "held",
        headline: "Waiting for a supervisor",
        detail:
          `Refunds over ${money(limits.approvalAboveCents)} need a supervisor to sign them off, ` +
          "and it cannot be you. Nothing is owed to the customer until someone signs — tell them " +
          "it is being reviewed, not that it is done.",
      };
    case "denied_scope":
      return {
        tone: "refused",
        headline: "Not yours to do",
        detail:
          "Your account is not able to take this action. If you think it should be, your manager " +
          "can ask for the access rather than working around it.",
      };
    case "denied_limit":
      return {
        tone: "refused",
        headline: "Above the refund limit",
        detail:
          `${money(limits.ceilingCents)} is the most that can be refunded through this desk in ` +
          "one go, and no supervisor can sign past it. Anything larger has to go to the payments " +
          "team directly.",
      };
    case "rate_limited":
      return {
        tone: "refused",
        headline: "Too many refunds this hour",
        detail:
          `You have used the ${limits.perHour ?? "hourly"} refunds allowed in an hour. Wait for ` +
          "the hour to roll over, or hand the case to a colleague if the customer cannot wait.",
      };
    case "invalid_input":
      return {
        tone: "refused",
        headline: "Something is missing",
        detail: result.message ?? "Check the amount and the reason, then try again.",
      };
    case "not_found":
      return {
        tone: "refused",
        headline: "No such payment",
        detail: "That payment is not on the system any more. Search for it again from the top.",
      };
    case "conflict":
      return {
        tone: "refused",
        headline: "The payment has moved on",
        detail:
          (result.message ?? "Someone refunded against this payment while you were looking at it.") +
          " Reload the payment to see what is left.",
      };
    case "halted":
      return {
        tone: "refused",
        headline: "Refunds are paused",
        detail:
          "Refunding is paused across the desk while a discrepancy is investigated. Reading " +
          "payments still works; an administrator has to lift the pause.",
      };
    case "invariant_violation":
      return {
        tone: "refused",
        headline: "Refused and rolled back",
        detail:
          "This refund would have broken a rule the platform guarantees, so nothing was " +
          "recorded. Raise it with the payments team rather than trying again.",
      };
    default:
      return {
        tone: "refused",
        headline: "It did not go through",
        detail:
          "Nothing was recorded, so the customer has not been refunded. Try again; if it keeps " +
          "failing, the payments team needs to know.",
      };
  }
}

const CLASS: Record<Tone, string> = { ok: "ok", held: "warn", refused: "bad" };

export function OutcomeNotice({
  result,
  limits,
}: {
  result: InvokeResult<unknown> | null;
  limits: DeskLimits;
}) {
  if (!result) return null;
  const explained = explain(result, limits);
  return (
    <div className={`outcome-banner ${CLASS[explained.tone]}`}>
      <strong>{explained.headline}</strong>
      <div>{explained.detail}</div>
    </div>
  );
}
