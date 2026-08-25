import { useCapability } from '../platform/PlatformProvider';
import { Empty, Section, relativeTime } from '../components/ui';

export function AuditView() {
  const { data, loading } = useCapability('kyc.audit.list', { limit: 200 });
  const entries = data?.entries ?? [];

  return (
    <Section title="Audit trail" aside={<span className="muted">Written by the runtime before any result is returned</span>}>
      {loading && entries.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : entries.length === 0 ? (
        <Empty>No invocations yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Audit ID</th>
              <th>When</th>
              <th>Actor</th>
              <th>Capability</th>
              <th>Target</th>
              <th>Outcome</th>
              <th>Policy</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.severity === 'high' ? 'row--high' : undefined}>
                <td>
                  <code>{entry.id}</code>
                </td>
                <td className="muted">{relativeTime(entry.at)}</td>
                <td>
                  {entry.actor}
                  <span className="muted"> · {entry.role}</span>
                </td>
                <td>
                  <code>{entry.capability}</code>
                </td>
                <td>{entry.target}</td>
                <td>
                  <span className={`pill pill--${entry.outcome}`}>{entry.outcome.replace(/_/g, ' ')}</span>
                </td>
                <td className="muted">{entry.policy}</td>
                <td className="detail">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
