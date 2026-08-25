import { useState } from 'react';
import { useCapability } from '../platform/PlatformProvider';
import type { CaseStatus, RiskBand } from '../platform/contracts';
import { Empty, PolicyChip, RiskPill, Section, StatusPill, relativeTime } from '../components/ui';

const STATUSES: (CaseStatus | 'all')[] = [
  'all',
  'pending_review',
  'awaiting_approval',
  'info_requested',
  'escalated',
  'approved',
  'rejected',
];

const RISK_BANDS: (RiskBand | 'all')[] = ['all', 'low', 'medium', 'high'];

export function QueueView({ onOpen }: { onOpen: (caseId: string) => void }) {
  const [status, setStatus] = useState<CaseStatus | 'all'>('all');
  const [riskBand, setRiskBand] = useState<RiskBand | 'all'>('all');
  const [assignment, setAssignment] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [query, setQuery] = useState('');

  const { data, loading } = useCapability('kyc.cases.list', { status, riskBand, assignment, query });
  const cases = data?.cases ?? [];

  return (
    <Section title="Review queue" aside={<PolicyChip capability="kyc.cases.list" />}>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as CaseStatus | 'all')}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Risk
          <select value={riskBand} onChange={(event) => setRiskBand(event.target.value as RiskBand | 'all')}>
            {RISK_BANDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignment
          <select
            value={assignment}
            onChange={(event) => setAssignment(event.target.value as 'all' | 'mine' | 'unassigned')}
          >
            <option value="all">all</option>
            <option value="mine">mine</option>
            <option value="unassigned">unassigned</option>
          </select>
        </label>
        <label className="filters__search">
          Search
          <input
            value={query}
            placeholder="Reference, name or country"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loading && cases.length === 0 ? (
        <Empty>Loading queue…</Empty>
      ) : cases.length === 0 ? (
        <Empty>No cases match these filters.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Applicant</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Hits</th>
              <th>SLA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => {
              const breached = new Date(item.slaDueAt).getTime() < Date.now();
              return (
                <tr key={item.id} onClick={() => onOpen(item.id)} className="table__row">
                  <td>
                    <code>{item.reference}</code>
                    <span className="muted"> r{item.revision}</span>
                  </td>
                  <td>
                    {item.applicantName}
                    <span className="muted"> · {item.country}</span>
                  </td>
                  <td>
                    <StatusPill status={item.status} />
                  </td>
                  <td>
                    <RiskPill band={item.riskBand} score={item.riskScore} />
                  </td>
                  <td>{item.unresolvedHits > 0 ? <span className="hits">{item.unresolvedHits} unresolved</span> : '—'}</td>
                  <td className={breached ? 'sla sla--breached' : 'sla'}>{relativeTime(item.slaDueAt)}</td>
                  <td>
                    <button type="button" className="btn btn--ghost">
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
