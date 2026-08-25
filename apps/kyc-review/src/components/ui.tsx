import type { ReactNode } from 'react';
import type { CapabilityName, CaseStatus, RiskBand } from '../platform/contracts';
import { CAPABILITY_POLICIES } from '../platform/contracts';

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  pending_review: 'Pending review',
  info_requested: 'Info requested',
  escalated: 'Escalated (EDD)',
  approved: 'Approved',
  rejected: 'Rejected',
  awaiting_approval: 'Awaiting approval',
};

export function StatusPill({ status }: { status: CaseStatus }) {
  return <Pill tone={status}>{STATUS_LABEL[status]}</Pill>;
}

export function RiskPill({ band, score }: { band: RiskBand; score: number }) {
  return (
    <Pill tone={`risk-${band}`}>
      {band} · {score}
    </Pill>
  );
}

/** Shows the policy the runtime will apply, so the rules are visible rather than implied by the UI. */
export function PolicyChip({ capability }: { capability: CapabilityName }) {
  const policy = CAPABILITY_POLICIES[capability];
  return (
    <span className="policy-chip" title={policy.description}>
      <code>{capability}</code>
      <span>
        {policy.scope} · {policy.limit}
        {policy.approval !== 'none' ? ` · approval: ${policy.approval}` : ''}
      </span>
    </span>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section__header">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function relativeTime(iso: string): string {
  const deltaMs = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(deltaMs / 60_000);
  const abs = Math.abs(minutes);
  const [value, unit] = abs < 60 ? [abs, 'min'] : abs < 1440 ? [Math.round(abs / 60), 'hr'] : [Math.round(abs / 1440), 'day'];
  const plural = value === 1 ? '' : 's';
  return minutes < 0 ? `${value} ${unit}${plural} ago` : `in ${value} ${unit}${plural}`;
}
