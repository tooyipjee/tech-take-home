import { useState } from 'react';
import { useCapability, useDescriptor, usePlatform } from '../platform/PlatformProvider';
import type {
  ApprovalRequirement,
  CaseDetail,
  MaskedIdentity,
  RejectReasonCode,
} from '../platform/contracts';
import { REJECT_REASONS, scopeOf } from '../platform/contracts';
import { Empty, PolicyChip, RiskPill, StatusPill, relativeTime } from '../components/ui';

const INFO_ITEMS = ['Proof of address (<90 days)', 'Source of funds statement', 'Selfie liveness check', 'Business registration'];

export function CaseView({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const { data, loading, error } = useCapability('kyc.cases.get', { caseId });
  if (loading && !data) return <Empty>Loading case…</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Case unavailable.</Empty>;
  return (
    <CaseDetailPanel
      key={data.case.revision}
      detail={data.case}
      decisionApproval={data.decisionApproval}
      onBack={onBack}
    />
  );
}

function CaseDetailPanel({
  detail,
  decisionApproval,
  onBack,
}: {
  detail: CaseDetail;
  decisionApproval: ApprovalRequirement | null;
  onBack: () => void;
}) {
  const { invoke, actor } = usePlatform();
  const [revealed, setRevealed] = useState<MaskedIdentity | null>(null);

  const claim = () =>
    invoke(
      'kyc.case.claim',
      { caseId: detail.id, revision: detail.revision },
      { idempotencyKey: `claim:${detail.id}:${actor.id}`, successMessage: 'Case claimed' },
    );

  return (
    <div className="case">
      <div className="case__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Queue
        </button>
        <h2>
          <code>{detail.reference}</code> {detail.applicantName}
        </h2>
        <StatusPill status={detail.status} />
        <RiskPill band={detail.riskBand} score={detail.riskScore} />
        <span className="muted">revision r{detail.revision}</span>
        <span className="spacer" />
        {detail.assignedTo === actor.id ? (
          <span className="muted">Assigned to you</span>
        ) : (
          <button type="button" className="btn" onClick={claim}>
            Claim
          </button>
        )}
      </div>

      <div className="case__grid">
        <div className="case__column">
          <IdentityCard detail={detail} revealed={revealed} onReveal={setRevealed} />
          <ScreeningCard detail={detail} />
          <DocumentsCard detail={detail} />
          <RiskCard detail={detail} />
        </div>
        <div className="case__column">
          <DecisionCard detail={detail} decisionApproval={decisionApproval} />
          <TimelineCard detail={detail} />
        </div>
      </div>
    </div>
  );
}

function IdentityCard({
  detail,
  revealed,
  onReveal,
}: {
  detail: CaseDetail;
  revealed: MaskedIdentity | null;
  onReveal: (identity: MaskedIdentity | null) => void;
}) {
  const { invoke } = usePlatform();
  const revealDescriptor = useDescriptor('kyc.case.pii.reveal');
  const [justification, setJustification] = useState('');
  const [asking, setAsking] = useState(false);
  const identity = revealed ?? detail.identity;

  const reveal = async () => {
    const result = await invoke(
      'kyc.case.pii.reveal',
      { caseId: detail.id, justification },
      {
        // A fresh key per disclosure: two reveals are two disclosures, and replaying one would
        // hide the second from the audit log.
        idempotencyKey: `reveal:${detail.id}:${Date.now()}`,
        successMessage: 'PII revealed (audited on its own)',
      },
    );
    if (result.outcome === 'ok' && result.result) {
      onReveal(result.result.identity);
      setAsking(false);
      setJustification('');
    }
  };

  return (
    <article className="card">
      <header className="card__header">
        <h3>Applicant</h3>
        {identity.masked ? (
          <button type="button" className="btn btn--ghost" onClick={() => setAsking((value) => !value)}>
            Reveal PII
          </button>
        ) : (
          <span className="pill pill--revealed">unmasked</span>
        )}
      </header>

      {asking && identity.masked && (
        <div className="reveal">
          <p className="muted">{revealDescriptor?.summary}</p>
          <textarea
            value={justification}
            placeholder="Why do you need the raw identifiers? (min 10 characters)"
            onChange={(event) => setJustification(event.target.value)}
          />
          <div className="row">
            <PolicyChip capability="kyc.case.pii.reveal" />
            <span className="spacer" />
            <button type="button" className="btn" onClick={reveal}>
              Unmask
            </button>
          </div>
        </div>
      )}

      <dl className="facts">
        <dt>Name</dt>
        <dd>{identity.fullName}</dd>
        <dt>Email</dt>
        <dd>{identity.email}</dd>
        <dt>Date of birth</dt>
        <dd>{identity.dateOfBirth}</dd>
        <dt>National ID</dt>
        <dd>{identity.nationalId}</dd>
        <dt>Address</dt>
        <dd>{identity.address}</dd>
        <dt>Product</dt>
        <dd>{detail.productTier}</dd>
        <dt>Expected volume</dt>
        <dd>${detail.expectedMonthlyVolumeUsd.toLocaleString()} / mo</dd>
      </dl>
    </article>
  );
}

function ScreeningCard({ detail }: { detail: CaseDetail }) {
  return (
    <article className="card">
      <header className="card__header">
        <h3>Screening hits</h3>
      </header>
      {detail.screeningHits.length === 0 ? (
        <p className="muted">No hits returned by screening providers.</p>
      ) : (
        <ul className="list">
          {detail.screeningHits.map((hit) => (
            <li key={hit.id}>
              <div className="row">
                <strong>{hit.list.replace(/_/g, ' ')}</strong>
                <span className="spacer" />
                <span className={hit.matchStrength > 0.85 ? 'hits' : 'muted'}>
                  {(hit.matchStrength * 100).toFixed(0)}% match
                </span>
              </div>
              <p className="muted">
                {hit.provider} matched “{hit.matchedName}” · {hit.resolution.replace(/_/g, ' ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function DocumentsCard({ detail }: { detail: CaseDetail }) {
  return (
    <article className="card">
      <header className="card__header">
        <h3>Documents</h3>
      </header>
      <ul className="list">
        {detail.documents.map((document) => (
          <li key={document.id}>
            <div className="row">
              <strong>{document.type.replace(/_/g, ' ')}</strong>
              <span className="spacer" />
              <span className={document.verification === 'passed' ? 'muted' : 'hits'}>{document.verification}</span>
            </div>
            <p className="muted">
              Uploaded {relativeTime(document.uploadedAt)}
              {document.note ? ` · ${document.note}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function RiskCard({ detail }: { detail: CaseDetail }) {
  return (
    <article className="card">
      <header className="card__header">
        <h3>Risk score {detail.riskScore}</h3>
      </header>
      <ul className="list">
        {detail.riskSignals.map((signal) => (
          <li key={signal.label}>
            <div className="row">
              <strong>{signal.label}</strong>
              <span className="spacer" />
              <span>+{signal.points}</span>
            </div>
            <p className="muted">{signal.detail}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function DecisionCard({
  detail,
  decisionApproval,
}: {
  detail: CaseDetail;
  decisionApproval: ApprovalRequirement | null;
}) {
  const { invoke, actor } = usePlatform();
  const [mode, setMode] = useState<'approve' | 'reject' | 'info' | 'escalate' | 'sar'>('approve');
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState<RejectReasonCode>('identity_mismatch');
  const [items, setItems] = useState<string[]>([]);

  const terminal = detail.status === 'approved' || detail.status === 'rejected';
  const held = detail.status === 'awaiting_approval';
  const capability =
    mode === 'approve'
      ? 'kyc.case.approve'
      : mode === 'reject'
        ? 'kyc.case.reject'
        : mode === 'info'
          ? 'kyc.case.requestInfo'
          : mode === 'escalate'
            ? 'kyc.case.escalate'
            : 'kyc.case.sar.file';
  const descriptor = useDescriptor(capability);
  const scope = descriptor ? scopeOf(descriptor) : null;
  const holdsScope = scope === null || actor.scopes.includes(scope);
  // What the runtime says it will demand, asked of the case by the kernel and returned by
  // `kyc.cases.get` — never re-derived here.
  const requirement =
    capability === 'kyc.case.approve' || capability === 'kyc.case.reject' ? decisionApproval : null;
  const heldReason =
    capability === 'kyc.case.sar.file'
      ? 'Filing a SAR always waits for a second holder of kyc:sar.'
      : (requirement?.reason ?? null);

  const submit = async () => {
    const base = { caseId: detail.id, revision: detail.revision };
    const idempotencyKey = `${capability}:${detail.id}:${detail.revision}`;
    if (mode === 'approve') {
      await invoke('kyc.case.approve', { ...base, note }, { idempotencyKey, successMessage: 'Applicant approved' });
    } else if (mode === 'reject') {
      await invoke(
        'kyc.case.reject',
        { ...base, reasonCode, note },
        { idempotencyKey, successMessage: 'Applicant rejected' },
      );
    } else if (mode === 'info') {
      await invoke(
        'kyc.case.requestInfo',
        { ...base, items, note },
        { idempotencyKey, successMessage: 'Information requested' },
      );
    } else if (mode === 'escalate') {
      await invoke('kyc.case.escalate', { ...base, note }, { idempotencyKey, successMessage: 'Escalated to EDD' });
    } else {
      await invoke('kyc.case.sar.file', { ...base, narrative: note }, { idempotencyKey });
    }
    setNote('');
    setItems([]);
  };

  return (
    <article className="card card--decision">
      <header className="card__header">
        <h3>Decision</h3>
        <PolicyChip capability={capability} />
      </header>

      {terminal && <p className="banner banner--done">This case is {detail.status}. No further decisions are accepted.</p>}
      {held && (
        <p className="banner banner--held">
          A decision on this case is waiting for a second human. Check the approvals inbox.
        </p>
      )}

      <div className="tabs">
        {(
          [
            ['approve', 'Approve'],
            ['reject', 'Reject'],
            ['info', 'Request info'],
            ['escalate', 'Escalate'],
            ['sar', 'File SAR'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'tab tab--active' : 'tab'}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {!holdsScope && (
        <p className="banner banner--denied">
          Your role ({actor.role}) does not hold <code>{scope}</code>. The runtime will
          refuse this call — the button is left enabled deliberately, because hiding it is not a control.
        </p>
      )}

      {heldReason && <p className="banner banner--held">{heldReason}</p>}

      {mode === 'reject' && (
        <label className="field">
          Reason code
          <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as RejectReasonCode)}>
            {REJECT_REASONS.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'info' && (
        <fieldset className="field">
          <legend>Items to request</legend>
          {INFO_ITEMS.map((item) => (
            <label key={item} className="checkbox">
              <input
                type="checkbox"
                checked={items.includes(item)}
                onChange={(event) =>
                  setItems((current) =>
                    event.target.checked ? [...current, item] : current.filter((value) => value !== item),
                  )
                }
              />
              {item}
            </label>
          ))}
        </fieldset>
      )}

      <label className="field">
        {mode === 'sar' ? 'SAR narrative (min 40 characters)' : 'Rationale (min 20 characters)'}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
      </label>

      <div className="row">
        <span className="muted">
          Idempotency: <code>{`${detail.id}:r${detail.revision}`}</code>
        </span>
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={submit} disabled={terminal}>
          {mode === 'sar' ? 'File SAR' : mode === 'info' ? 'Send request' : `Submit ${mode}`}
        </button>
      </div>
    </article>
  );
}

function TimelineCard({ detail }: { detail: CaseDetail }) {
  return (
    <article className="card">
      <header className="card__header">
        <h3>Timeline</h3>
      </header>
      <ol className="timeline">
        {[...detail.timeline].reverse().map((event) => (
          <li key={event.id}>
            <div className="row">
              <strong>{event.actor}</strong>
              <span className="spacer" />
              <span className="muted">{relativeTime(event.at)}</span>
            </div>
            <p>{event.summary}</p>
            {event.capability && (
              <p className="muted">
                <code>{event.capability}</code>
                {event.auditId ? ` · audit ${event.auditId}` : ''}
              </p>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}
