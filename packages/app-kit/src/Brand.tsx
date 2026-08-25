/**
 * The one piece of identity the platform shows everywhere: the frame mark, the
 * wordmark, and — inside an app — the app's own name hanging off it, so it is
 * always obvious that a screen is running on Rangka rather than beside it.
 */
export function Brand({ app }: { app?: string }) {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-words">
        <span className="brand-name">Rangka</span>
        {app ? <span className="brand-app">{app}</span> : null}
      </span>
    </span>
  );
}

/** A frame: an outer rail with the crossbar things are hung from. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <path d="M2.5 9.5h19" />
      <path d="M8.5 9.5v12" />
      <path d="M15.5 9.5v12" />
    </svg>
  );
}

/**
 * Job titles for the platform's roles. What the role *grants* is the kernel's
 * business and is never on screen; what it is *called* is all a person needs to
 * recognise themselves in the corner of the page.
 */
const ROLE_TITLE: Record<string, string> = {
  agent: "KYC reviewer",
  supervisor: "KYC lead",
  admin: "Compliance officer",
};

export function roleTitle(role: string): string {
  return ROLE_TITLE[role] ?? role;
}

/** Two letters for an avatar chip — the name is right next to it, so this is decoration. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
