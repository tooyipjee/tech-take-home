import { useState } from 'react';
import { PlatformProvider, usePlatform } from './platform/PlatformProvider';
import { QueueView } from './views/QueueView';
import { CaseView } from './views/CaseView';
import { ApprovalsView } from './views/ApprovalsView';
import { AuditView } from './views/AuditView';

type Tab = 'queue' | 'approvals' | 'audit';

const ROLE_LABEL: Record<string, string> = {
  kyc_reviewer: 'Reviewer',
  kyc_lead: 'Lead',
  compliance_officer: 'Compliance',
};

export default function App() {
  return (
    <PlatformProvider>
      <Shell />
    </PlatformProvider>
  );
}

function Shell() {
  const { actor, directory, setActorId, adapter } = usePlatform();
  const [tab, setTab] = useState<Tab>('queue');
  const [caseId, setCaseId] = useState<string | null>(null);

  const openCase = (id: string) => {
    setCaseId(id);
    setTab('queue');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>KYC Review Queue</strong>
          <span className="muted">an app on the Align capability platform</span>
        </div>
        <nav className="nav">
          {(
            [
              ['queue', 'Queue'],
              ['approvals', 'Approvals'],
              ['audit', 'Audit'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? 'nav__item nav__item--active' : 'nav__item'}
              onClick={() => {
                setTab(value);
                if (value !== 'queue') setCaseId(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="identity">
          <span className={`pill pill--adapter-${adapter}`}>{adapter} kernel</span>
          <label>
            Acting as
            <select value={actor.userId} onChange={(event) => setActorId(event.target.value)}>
              {directory.map((entry) => (
                <option key={entry.userId} value={entry.userId}>
                  {ROLE_LABEL[entry.role]} · {entry.displayName}
                </option>
              ))}
            </select>
          </label>
          <span className="muted scopes">{actor.scopes.join(' ')}</span>
        </div>
      </header>

      <main className="main">
        {tab === 'queue' && caseId ? (
          <CaseView caseId={caseId} onBack={() => setCaseId(null)} />
        ) : tab === 'queue' ? (
          <QueueView onOpen={setCaseId} />
        ) : tab === 'approvals' ? (
          <ApprovalsView onOpen={openCase} />
        ) : (
          <AuditView />
        )}
      </main>

      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = usePlatform();
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => dismissToast(toast.id)}>
          <strong>{toast.title}</strong>
          <p>{toast.detail}</p>
          <span className="muted">audit {toast.auditId}</span>
        </div>
      ))}
    </div>
  );
}
