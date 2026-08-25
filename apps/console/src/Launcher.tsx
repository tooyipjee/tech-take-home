/**
 * One row per app. An app is a folder under `apps/` served on its own port, so
 * the launcher links out rather than importing it: nothing an app does can reach
 * the console's code, and adding an app changes this list only.
 */
const APPS = [
  {
    name: "KYC review queue",
    folder: "apps/kyc-review",
    url: "http://localhost:5174",
    scopes: ["kyc:read", "kyc:pii", "kyc:review", "kyc:decide", "kyc:sar"],
    blurb: "Onboarding cases: PII reveal is metered, decisions are four-eyed, SARs need compliance.",
  },
];

export function Launcher() {
  return (
    <>
      <h2>Apps</h2>
      <p className="hint">
        Each app is a folder in <code>apps/</code> with its own dev server, talking to this platform
        through <code>@platform/sdk</code>. The console itself is not an app: it is approvals, audit,
        the registry and invariant health.
      </p>
      <table>
        <thead>
          <tr>
            <th>App</th>
            <th>Folder</th>
            <th>Scopes it needs</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {APPS.map((app) => (
            <tr key={app.folder}>
              <td>
                <strong>{app.name}</strong>
                <div>
                  <code>{app.blurb}</code>
                </div>
              </td>
              <td>
                <code>{app.folder}</code>
              </td>
              <td>
                {app.scopes.map((scope) => (
                  <span key={scope} className="badge">
                    {scope}
                  </span>
                ))}
              </td>
              <td>
                <a className="action" href={app.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
