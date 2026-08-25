import { usePlatform, usePlatformData } from '../platform/PlatformProvider';
import { actionLabel } from '../platform/contracts';
import { Empty, Section, relativeTime } from '../components/ui';

/** The platform audit log, unfiltered by the app: refusals appear next to effects. */
export function AuditView() {
  const { directory } = usePlatform();
  const { data, error } = usePlatformData((client) => client.audit(200));
  const entries = data ?? [];
  const nameOf = (actorId: string) => directory.find((actor) => actor.id === actorId)?.name ?? actorId;

  return (
    <Section
      title="Audit trail"
      aside={<span className="muted">Written by the runtime before any result is returned</span>}
    >
      {error ? (
        <Empty>Refused: {error}</Empty>
      ) : entries.length === 0 ? (
        <Empty>No invocations yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Countersigned</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.capability === 'kyc.case.pii.reveal' ? 'row--high' : undefined}>
                <td>
                  <code>{entry.id}</code>
                </td>
                <td className="muted">{relativeTime(entry.at)}</td>
                <td>{nameOf(entry.actorId)}</td>
                <td title={entry.capability}>{actionLabel(entry.capability)}</td>
                <td>
                  <span className={`pill pill--${entry.outcome}`}>{entry.outcome.replace(/_/g, ' ')}</span>
                </td>
                <td className="muted">{entry.approvalId ? 'yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
