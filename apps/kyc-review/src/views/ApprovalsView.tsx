import { useState } from 'react';
import { useCapability, usePlatform } from '../platform/PlatformProvider';
import type { ApprovalRequest } from '../platform/contracts';
import { Empty, PolicyChip, Section, relativeTime } from '../components/ui';

export function ApprovalsView({ onOpen }: { onOpen: (caseId: string) => void }) {
  const { data, loading } = useCapability('kyc.approvals.list', {});
  const requests = data?.requests ?? [];
  const pending = requests.filter((request) => request.status === 'pending');
  const decided = requests.filter((request) => request.status !== 'pending');

  return (
    <Section title="Approvals inbox" aside={<PolicyChip capability="kyc.approvals.decide" />}>
      {loading && requests.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : pending.length === 0 ? (
        <Empty>Nothing waiting on a second human. Decide a high-risk case to see one appear here.</Empty>
      ) : (
        <ul className="approvals">
          {pending.map((request) => (
            <ApprovalRow key={request.id} request={request} onOpen={onOpen} />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <>
          <h3 className="subhead">Decided</h3>
          <ul className="approvals approvals--muted">
            {decided.map((request) => (
              <li key={request.id}>
                <div className="row">
                  <strong>{request.summary}</strong>
                  <span className="spacer" />
                  <span className={request.status === 'approved' ? 'muted' : 'hits'}>
                    {request.status} by {request.decidedBy}
                  </span>
                </div>
                <p className="muted">
                  <code>{request.capability}</code> · requested by {request.requestedBy}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function ApprovalRow({
  request,
  onOpen,
}: {
  request: ApprovalRequest;
  onOpen: (caseId: string) => void;
}) {
  const { invoke, actor } = usePlatform();
  const [note, setNote] = useState('');
  const isRequester = request.requestedById === actor.userId;

  const decide = (decision: 'approve' | 'deny') =>
    invoke(
      'kyc.approvals.decide',
      { requestId: request.id, decision, note },
      { idempotencyKey: `approval:${request.id}`, successMessage: `Request ${decision}d` },
    );

  return (
    <li>
      <div className="row">
        <strong>{request.summary}</strong>
        <span className="spacer" />
        <span className="pill pill--awaiting_approval">{request.tier.replace('_', ' ')}</span>
      </div>
      <p className="muted">
        <button type="button" className="linkish" onClick={() => onOpen(request.caseId)}>
          {request.caseReference}
        </button>{' '}
        · <code>{request.capability}</code> · requested by {request.requestedBy} {relativeTime(request.requestedAt)}
      </p>
      <blockquote>{request.reason}</blockquote>
      {isRequester ? (
        <p className="banner banner--denied">
          You raised this request. Four-eyes means someone else must decide it — the runtime will deny you.
        </p>
      ) : null}
      <div className="row">
        <input
          value={note}
          placeholder="Approval note"
          onChange={(event) => setNote(event.target.value)}
          className="grow"
        />
        <button type="button" className="btn" onClick={() => decide('deny')}>
          Deny
        </button>
        <button type="button" className="btn btn--primary" onClick={() => decide('approve')}>
          Approve
        </button>
      </div>
    </li>
  );
}
