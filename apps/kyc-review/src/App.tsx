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
          <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
            <path d="M2.5 9.5h19" />
            <path d="M8.5 9.5v12" />
            <path d="M15.5 9.5v12" />
          </svg>
          <span className="brand__words">
            <strong>Rangka</strong>
            <span className="brand__app">KYC review queue</span>
          </span>
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
        {/*
          Development sign-in: this switcher stands in for an OAuth/OIDC redirect.
          The scopes it grants are the platform's business, not the reviewer's, so
          they are not on screen — a refusal explains itself when one is missing.
        */}
        <label className="identity" title="Development sign-in — stands in for OAuth/OIDC">
          <span className="identity__avatar" aria-hidden="true">
            {actor.name
              .split(' ')
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
          <span className="identity__words">
            <select value={actor.id} onChange={(event) => setActorId(event.target.value)}>
              {directory.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <span className="identity__role">{ROLE_LABEL[actor.role]}</span>
          </span>
        </label>
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
