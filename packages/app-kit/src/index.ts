/**
 * What an app is given besides the SDK: one client bound to the acting user, the
 * identity switcher every app needs in development, the outcome vocabulary, and
 * the stylesheet. Shared here so a new app is a folder and a screen, not a
 * re-implementation of the shell — and so every app explains a refusal the same
 * way.
 */
import "./styles.css";

export { platform, setActingUser, getActingUser } from "./client.ts";
export { money, when } from "./format.ts";
export { OutcomeBanner, OutcomeBadge } from "./Outcome.tsx";
export { AppShell } from "./AppShell.tsx";
