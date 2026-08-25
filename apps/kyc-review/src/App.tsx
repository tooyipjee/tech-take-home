import { useState } from 'react';
import { PlatformProvider, usePlatform } from './platform/PlatformProvider';
import { QueueView } from './views/QueueView';
import { CaseView } from './views/CaseView';
import { ApprovalsView } from './views/ApprovalsView';
import { AuditView } from './views/AuditView';
import { ROLE_LABEL } from './platform/contracts';

type Tab = 'queue' | 'approvals' | 'audit';

export default function App() {
  return (
    <PlatformProvider>
      <Shell />
    </PlatformProvider>
  );
}

function Shell() {
  const { actor, directory, setActorId } = usePlatform();
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
          <label>
            Acting as
            <select value={actor.id} onChange={(event) => setActorId(event.target.value)}>
              {directory.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {ROLE_LABEL[entry.role]} · {entry.name}
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
        </div>
      ))}
    </div>
  );
}
