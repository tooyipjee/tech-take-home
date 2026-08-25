import { usePlatform, usePlatformData } from '../platform/PlatformProvider';
import type { KycApproval } from '../platform/contracts';
import { approvalCaseId } from '../platform/contracts';
import { Empty, Section, relativeTime } from '../components/ui';

/**
 * Approvals are a platform surface, not a KYC capability: the inbox reads `platform.approvals()`
 * and decides with `platform.decide()`, so an approval raised by any app is decided the same way.
 */
export function ApprovalsView({ onOpen }: { onOpen: (caseId: string) => void }) {
  const { directory } = usePlatform();
  const { data, error } = usePlatformData((client) => client.approvals());
  const nameOf = (userId: string) => directory.find((actor) => actor.id === userId)?.name ?? userId;
  const requests = data ?? [];
  const pending = requests.filter((request) => request.status === 'pending');
  const decided = requests.filter((request) => request.status !== 'pending');

  return (
    <Section title="Approvals inbox">
      {error ? (
        <Empty>Refused: {error}</Empty>
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
                  <strong>{request.reason}</strong>
                  <span className="spacer" />
                  <span className={request.status === 'rejected' || request.status === 'failed' ? 'hits' : 'muted'}>
                    {request.status}
                    {request.decidedBy ? ` by ${nameOf(request.decidedBy)}` : ''}
                  </span>
                </div>
                <p className="muted">
                  <code>{request.capability}</code> · requested by {request.requestedByName}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function ApprovalRow({ request, onOpen }: { request: KycApproval; onOpen: (caseId: string) => void }) {
  const { client, actor, bump } = usePlatform();
  const caseId = approvalCaseId(request);
  const isRequester = request.requestedBy === actor.id;
  const canDecide = actor.scopes.includes(request.approverScope) && actor.scopes.includes('approvals:decide');

  const decide = async (decision: 'approve' | 'reject') => {
    await client.decide(request.id, decision);
    bump();
  };

  return (
    <li>
      <div className="row">
        <strong>{request.reason}</strong>
        <span className="spacer" />
        <span className="pill pill--awaiting_approval">needs {request.approverScope}</span>
      </div>
      <p className="muted">
        {caseId ? (
          <button type="button" className="linkish" onClick={() => onOpen(caseId)}>
            {caseId}
          </button>
        ) : null}{' '}
        · <code>{request.capability}</code> · requested by {request.requestedByName}{' '}
        {relativeTime(request.createdAt)}
      </p>
      {isRequester ? (
        <p className="banner banner--denied">
          You raised this request. Four-eyes means someone else must decide it — the runtime will deny you.
        </p>
      ) : null}
      {!isRequester && !canDecide ? (
        <p className="banner banner--denied">
          Deciding this needs <code>{request.approverScope}</code>, which {actor.role} does not hold. The buttons stay
          enabled because the runtime, not the UI, is the control.
        </p>
      ) : null}
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void decide('reject')}>
          Reject
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void decide('approve')}>
          Approve
        </button>
      </div>
    </li>
  );
}
