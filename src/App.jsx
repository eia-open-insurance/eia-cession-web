import React, { useEffect, useState } from 'react';
import './ui.css';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'DIRECT';

const NEXT_STATUS = {
  OPEN: ['RULE_APPLIED', 'CANCELLED'],
  RULE_APPLIED: ['HANDOFF_PENDING', 'CANCELLED'],
  HANDOFF_PENDING: ['HANDED_OFF', 'REJECTED', 'CANCELLED'],
  HANDED_OFF: ['CONFIRMED', 'REJECTED'],
  REJECTED: ['HANDOFF_PENDING', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: []
};

const EMPTY_FORM = {
  policyId: '',
  cessionContractId: '',
  cededPremium: '0.0000',
  cededLoss: '0.0000',
  currency: 'USD'
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'handoff', label: 'FS-RI Hand-off' },
  { id: 'history', label: 'Status History' }
];

const STATUS_TONES = [
  ['green', ['HANDED_OFF', 'CONFIRMED']],
  ['amber', ['RULE_APPLIED', 'HANDOFF_PENDING']],
  ['red', ['REJECTED', 'CANCELLED']],
  ['blue', ['OPEN']]
];

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(880px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function label(value) {
  return String(value ?? '').replaceAll('_', ' ');
}

function humanize(value) {
  return value ? label(value) : '—';
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function statusTone(status) {
  const match = STATUS_TONES.find(([, statuses]) => statuses.includes(status));
  return match ? match[0] : 'blue';
}

function fsriTone(status) {
  const value = String(status ?? '').toUpperCase();
  if (['POSTED', 'ACCEPTED', 'CONFIRMED', 'ACKNOWLEDGED'].includes(value)) return 'green';
  if (['REJECTED', 'FAILED', 'ERROR'].includes(value)) return 'red';
  return 'amber';
}

function money(value, currency = 'USD') {
  const number = Number(value ?? 0);
  return `${currency || 'USD'} ${number.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function timestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function historyRows(cession) {
  const rows = [
    {
      id: 'created',
      event: 'Cession created',
      status: 'OPEN',
      tone: statusTone('OPEN'),
      reference: cession.cessionNumber,
      at: cession.createdAt
    },
    {
      id: 'current',
      event: 'Lifecycle status recorded',
      status: cession.status,
      tone: statusTone(cession.status),
      reference: `Version ${cession.version ?? '—'}`,
      at: cession.updatedAt
    }
  ];
  if (cession.fsriHandedOffAt || cession.fsriHandoffId || cession.fsriStatus) {
    rows.push({
      id: 'handoff',
      event: 'FS-RI hand-off acknowledged',
      status: cession.fsriStatus || 'ACKNOWLEDGED',
      tone: fsriTone(cession.fsriStatus),
      reference: cession.fsriHandoffId || '—',
      at: cession.fsriHandedOffAt
    });
  }
  if (cession.fsriLastError) {
    rows.push({
      id: 'handoff-error',
      event: 'FS-RI hand-off error recorded',
      status: 'ERROR',
      tone: 'red',
      reference: cession.fsriLastError,
      at: cession.updatedAt
    });
  }
  return rows;
}

async function failureMessage(response) {
  try {
    const body = await response.json();
    return body.message || body.code || `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'X-EIA-Tenant': TENANT,
      'X-EIA-Book': BOOK,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  if (response.status === 204) return null;
  return response.json();
}

function Field({ label: text, children, className = '' }) {
  return (
    <label className={`eia-field ${className}`.trim()}>
      <span>{text}</span>
      {children}
    </label>
  );
}

function ErrorText({ children }) {
  if (!children) return null;
  return <p role="alert" style={{ margin: '8px 0 0' }}>{children}</p>;
}

function handoffDisabledReason(cession, allowed) {
  if (!cession) return 'Select a cession from the queue.';
  if (allowed) return undefined;
  if (cession.status === 'OPEN') return 'Apply the cession rule before handing the case to FS-RI.';
  if (cession.status === 'HANDED_OFF') return 'The cession has already been handed off to FS-RI.';
  if (cession.status === 'CONFIRMED') return 'The cession is confirmed; no further FS-RI hand-off is required.';
  if (cession.status === 'CANCELLED') return 'A cancelled cession cannot be handed off.';
  return `No FS-RI hand-off is available from ${humanize(cession.status)}.`;
}

function StatusHistory({ cession }) {
  const rows = historyRows(cession);
  return (
    <section
      id="cession-panel-history"
      role="tabpanel"
      aria-labelledby="cession-tab-history"
    >
      <div className="eia-section-title">
        <h2>Status history</h2>
        <span className="eia-muted">{rows.length} entries</span>
      </div>
      <div className="eia-table-wrap">
        <table className="eia-table" data-testid="status-history">
          <thead>
            <tr>
              <th>Event</th>
              <th>Status</th>
              <th>Reference</th>
              <th>Recorded at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.event}</td>
                <td><span className={`eia-pill ${row.tone}`}>{row.status}</span></td>
                <td style={{ overflowWrap: 'anywhere' }}>{row.reference}</td>
                <td className="eia-nowrap">{timestamp(row.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="eia-muted" style={{ marginTop: 8 }}>
        Derived from the cession record: creation and update timestamps, the current lifecycle status,
        and the persisted FS-RI acknowledgement. No separate status-event log is exposed by the API.
      </p>
    </section>
  );
}

export default function App() {
  const [cessions, setCessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [form, setForm] = useState(EMPTY_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [handoffContractNumber, setHandoffContractNumber] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState('');
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedCession = cessions.find((cession) => cession.id === selectedId) || null;
  const currency = selectedCession?.currency || 'USD';
  const nextStatuses = selectedCession ? (NEXT_STATUS[selectedCession.status] || []) : [];
  const localTargets = nextStatuses.filter((target) => {
    if (target === 'HANDOFF_PENDING') return false;
    if (selectedCession?.status === 'HANDOFF_PENDING' && target === 'HANDED_OFF') return false;
    return true;
  });
  const canHandOff = nextStatuses.includes('HANDOFF_PENDING');
  const disabledHandoffReason = handoffDisabledReason(selectedCession, canHandOff);

  async function load() {
    const rows = await request('/api/v1/cessions');
    const next = Array.isArray(rows) ? rows : [];
    setCessions(next);
    return next;
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && cessions.some((cession) => cession.id === current)) return current;
      return cessions[0]?.id || null;
    });
  }, [cessions]);

  useEffect(() => {
    setActiveTab('overview');
    setTransitionTarget('');
    setHandoffContractNumber('');
  }, [selectedId]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !createBusy) {
        setCreateOpen(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, createBusy]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function selectCession(cession) {
    if (cession.id !== selectedId) setSelectedId(cession.id);
    setError('');
    setNotice('');
  }

  async function refresh() {
    setError('');
    try {
      await load();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError('');
    setNotice('');
    setCreateOpen(true);
  }

  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
    setError('');
  }

  async function submitCreate(event) {
    event.preventDefault();
    setCreateBusy(true);
    setError('');
    try {
      const created = await request('/api/v1/cessions', {
        method: 'POST',
        body: JSON.stringify({
          policyId: form.policyId.trim(),
          cessionContractId: form.cessionContractId.trim(),
          cededPremium: Number(form.cededPremium || 0),
          cededLoss: Number(form.cededLoss || 0),
          currency: form.currency.trim().toUpperCase()
        })
      });
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      await load();
      if (created?.id) setSelectedId(created.id);
      setActiveTab('overview');
      setNotice(
        created?.cessionNumber
          ? `Cession ${created.cessionNumber} created on the DIRECT book.`
          : 'Cession created on the DIRECT book.'
      );
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function applyTransition() {
    if (!selectedCession || !transitionTarget) return;
    setTransitionBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await request(`/api/v1/cessions/${selectedCession.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ targetStatus: transitionTarget })
      });
      await load();
      if (updated?.id) setSelectedId(updated.id);
      setNotice(`Cession moved to ${humanize(updated?.status || transitionTarget)}.`);
      setTransitionTarget('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setTransitionBusy(false);
    }
  }

  async function handOff(event) {
    if (event) event.preventDefault();
    if (!selectedCession || !canHandOff) return;
    setHandoffBusy(true);
    setError('');
    setNotice('');
    try {
      const reference = handoffContractNumber.trim();
      const body = { targetStatus: 'HANDOFF_PENDING' };
      if (reference) body.fsriContractNumber = reference;
      const updated = await request(`/api/v1/cessions/${selectedCession.id}/transition`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      await load();
      if (updated?.id) setSelectedId(updated.id);
      setHandoffContractNumber('');
      setNotice(
        updated?.fsriHandoffId
          ? `FS-RI acknowledged the hand-off with reference ${updated.fsriHandoffId}.`
          : 'FS-RI acknowledged the cession hand-off.'
      );
    } catch (cause) {
      setError(cause.message);
    } finally {
      setHandoffBusy(false);
    }
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Reinsurance · Direct book</div>
          <h1>Cession</h1>
          <p className="subtitle">
            Direct-book outward cessions, ceded premium and loss, lifecycle, and the SAP FS-RI hand-off.
            FS-RI remains the system of record for actual ceded amounts, recoverables, and statements.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct" data-testid="book-badge" aria-label="Book scope">
            DIRECT book
          </span>
          <button type="button" className="eia-btn-ghost" onClick={refresh}>
            Refresh
          </button>
          <button type="button" onClick={openCreate} aria-haspopup="dialog">
            Create cession
          </button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !createOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Cession queue">
          <div className="eia-record-list-head">
            <strong>Cession queue</strong>
            <span className="eia-muted">{loading ? '…' : cessions.length}</span>
          </div>
          {cessions.map((cession) => (
            <button
              key={cession.id}
              type="button"
              className={cession.id === selectedId ? 'selected' : ''}
              aria-current={cession.id === selectedId ? 'true' : undefined}
              onClick={() => selectCession(cession)}
            >
              <span className="record-primary">{cession.cessionNumber}</span>
              <span className="record-secondary">Policy {shortId(cession.policyId)}</span>
              <span
                className="record-secondary"
                style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span className={`eia-pill ${statusTone(cession.status)}`}>{cession.status}</span>
                <span>{money(cession.cededPremium, cession.currency || 'USD')}</span>
              </span>
            </button>
          ))}
          {!loading && cessions.length === 0 && (
            <div className="empty">No cession cases on the DIRECT book yet.</div>
          )}
          {loading && <div className="empty">Loading the DIRECT cession queue…</div>}
        </aside>

        <section className="eia-record-panel" aria-label="Cession record">
          {!selectedCession ? (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the DIRECT cession queue…'
                  : 'Select a cession from the queue or create the first DIRECT cession.'}
              </p>
              {!loading && (
                <button type="button" onClick={openCreate} aria-haspopup="dialog">
                  Create cession
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="eia-record-title" style={{ flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 className="eia-mono">{selectedCession.cessionNumber}</h2>
                    <span
                      className={`eia-pill ${statusTone(selectedCession.status)}`}
                      data-testid="cession-status"
                    >
                      {selectedCession.status}
                    </span>
                  </div>
                  <p className="eia-record-subtitle">
                    Ceded premium {money(selectedCession.cededPremium, currency)}
                    {' · '}Ceded loss {money(selectedCession.cededLoss, currency)}
                    {' · '}Policy {shortId(selectedCession.policyId)}
                    {' · '}Contract {shortId(selectedCession.cessionContractId)}
                    {' · '}v{selectedCession.version ?? '—'}
                  </p>
                </div>
                <div className="eia-actions">
                  <button type="button" className="eia-btn-ghost" onClick={refresh}>
                    Refresh record
                  </button>
                  <button
                    type="button"
                    onClick={handOff}
                    disabled={!canHandOff || handoffBusy}
                    title={disabledHandoffReason}
                  >
                    {handoffBusy ? 'Handing off…' : 'Hand off to FS-RI'}
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Ceded premium</h3>
                  <div className="value" data-testid="summary-ceded-premium">
                    {money(selectedCession.cededPremium, currency)}
                  </div>
                  <div className="eia-metric-label">expected cession premium</div>
                </div>
                <div className="eia-card">
                  <h3>Ceded loss</h3>
                  <div className="value" data-testid="summary-ceded-loss">
                    {money(selectedCession.cededLoss, currency)}
                  </div>
                  <div className="eia-metric-label">expected cession loss</div>
                </div>
                <div className="eia-card">
                  <h3>FS-RI status</h3>
                  <div className="value" data-testid="summary-fsri-status">
                    {selectedCession.fsriStatus || 'Not handed off'}
                  </div>
                  <div className="eia-metric-label">
                    {selectedCession.fsriStatus
                      ? 'FS-RI acknowledgement'
                      : 'FS-RI is the system of record'}
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Hand-off reference</h3>
                  <div
                    className="value eia-mono"
                    data-testid="summary-handoff-ref"
                    style={{ fontSize: 13, overflowWrap: 'anywhere' }}
                  >
                    {selectedCession.fsriHandoffId || '—'}
                  </div>
                  <div className="eia-metric-label">
                    {selectedCession.fsriHandedOffAt
                      ? timestamp(selectedCession.fsriHandedOffAt)
                      : 'no FS-RI reference'}
                  </div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Cession sections">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`cession-tab-${entry.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${activeTab === entry.id ? ' active' : ''}`}
                    aria-selected={activeTab === entry.id}
                    aria-controls={`cession-panel-${entry.id}`}
                    onClick={() => setActiveTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              {activeTab === 'overview' && (
                <section
                  id="cession-panel-overview"
                  role="tabpanel"
                  aria-labelledby="cession-tab-overview"
                >
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="Cession details">
                      <h3>Cession details</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Cession number</dt>
                        <dd className="eia-mono">{selectedCession.cessionNumber}</dd>
                        <dt>Business book</dt>
                        <dd><span className="eia-badge direct">DIRECT</span></dd>
                        <dt>Policy</dt>
                        <dd className="eia-mono">{selectedCession.policyId || '—'}</dd>
                        <dt>Ceded contract</dt>
                        <dd className="eia-mono">{selectedCession.cessionContractId || '—'}</dd>
                        <dt>Currency</dt>
                        <dd>{currency}</dd>
                        <dt>Version</dt>
                        <dd>{selectedCession.version ?? '—'}</dd>
                        <dt>Created</dt>
                        <dd>{timestamp(selectedCession.createdAt)}</dd>
                        <dt>Updated</dt>
                        <dd>{timestamp(selectedCession.updatedAt)}</dd>
                      </dl>
                    </section>

                    <section className="eia-card" aria-label="Lifecycle">
                      <h3>Lifecycle</h3>
                      <p className="eia-muted" style={{ marginTop: 6 }}>
                        {nextStatuses.length
                          ? `Next allowed states from ${humanize(selectedCession.status)}.`
                          : `No further transitions from ${humanize(selectedCession.status)}.`}
                      </p>

                      {localTargets.length > 0 && (
                        <div className="eia-form-grid" style={{ marginTop: 6 }}>
                          <div className="eia-field span-2">
                            <label htmlFor="transition-status">Transition to</label>
                            <select
                              id="transition-status"
                              value={transitionTarget}
                              onChange={(event) => setTransitionTarget(event.target.value)}
                            >
                              <option value="">—</option>
                              {localTargets.map((target) => (
                                <option key={target} value={target}>{humanize(target)}</option>
                              ))}
                            </select>
                          </div>
                          <div className="eia-field">
                            <button
                              type="button"
                              className="eia-btn-secondary"
                              onClick={applyTransition}
                              disabled={!transitionTarget || transitionBusy}
                            >
                              {transitionBusy ? 'Applying…' : 'Apply transition'}
                            </button>
                          </div>
                        </div>
                      )}

                      {canHandOff && (
                        <p className="eia-muted" style={{ marginTop: 10 }}>
                          The FS-RI hand-off is performed from the FS-RI Hand-off tab or the primary
                          hand-off action; it is recorded only after an FS-RI acknowledgement.
                        </p>
                      )}

                      <div className="eia-divider" />
                      <p className="eia-muted" style={{ margin: 0 }}>
                        Cession is DIRECT-only. Contract terms and cession rules are owned here; actual
                        ceded amounts, recoverables, and statements remain in SAP FS-RI.
                      </p>
                    </section>
                  </div>
                </section>
              )}

              {activeTab === 'handoff' && (
                <section
                  id="cession-panel-handoff"
                  role="tabpanel"
                  aria-labelledby="cession-tab-handoff"
                >
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="FS-RI hand-off">
                      <h3>FS-RI hand-off</h3>
                      <p className="eia-muted" style={{ marginTop: 6 }}>
                        Send the cession case to SAP FS-RI. The hand-off is idempotent and immutable;
                        a contract or source change creates a new case version and hand-off.
                      </p>

                      {canHandOff ? (
                        <form className="eia-form-grid" onSubmit={handOff} style={{ marginTop: 10 }}>
                          <Field label="FS-RI contract number (optional)" className="span-2">
                            <input
                              id="fsriContractNumber"
                              value={handoffContractNumber}
                              onChange={(event) => setHandoffContractNumber(event.target.value)}
                              maxLength={32}
                              placeholder={selectedCession.cessionNumber}
                            />
                          </Field>
                          <div className="eia-field">
                            <button type="submit" disabled={handoffBusy}>
                              {handoffBusy ? 'Handing off…' : 'Hand off to FS-RI'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="eia-empty" style={{ marginTop: 10 }}>
                          {disabledHandoffReason}
                        </div>
                      )}

                      {canHandOff && (
                        <p className="eia-muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                          Uppercase letters, digits, and hyphens. Defaults to the cession number.
                        </p>
                      )}

                      {selectedCession.fsriLastError && (
                        <p role="alert" style={{ marginTop: 12 }}>
                          Last FS-RI error: {selectedCession.fsriLastError}
                        </p>
                      )}
                    </section>

                    <section className="eia-card" aria-label="FS-RI hand-off record">
                      <h3>Hand-off record</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>FS-RI handoff ID</dt>
                        <dd className="eia-mono">{selectedCession.fsriHandoffId || '—'}</dd>
                        <dt>FS-RI status</dt>
                        <dd>
                          {selectedCession.fsriStatus ? (
                            <span className={`eia-pill ${fsriTone(selectedCession.fsriStatus)}`}>
                              {selectedCession.fsriStatus}
                            </span>
                          ) : (
                            '—'
                          )}
                        </dd>
                        <dt>Handed off at</dt>
                        <dd>{timestamp(selectedCession.fsriHandedOffAt)}</dd>
                        <dt>Last error</dt>
                        <dd>{selectedCession.fsriLastError || '—'}</dd>
                        <dt>System of record</dt>
                        <dd>SAP FS-RI</dd>
                      </dl>
                    </section>
                  </div>
                </section>
              )}

              {activeTab === 'history' && <StatusHistory cession={selectedCession} />}
            </>
          )}
        </section>
      </div>

      {createOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !createBusy) closeCreate();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-cession-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="create-cession-title" style={{ margin: 0 }}>Create cession</h2>
                <p className="eia-record-subtitle">
                  Create a cession case for a DIRECT policy and ceded contract. The request is walled
                  to the DIRECT book.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeCreate}
                disabled={createBusy}
              >
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submitCreate} style={{ marginTop: 16 }}>
              <Field label="Policy ID" className="span-2">
                <input
                  id="policyId"
                  value={form.policyId}
                  onChange={update('policyId')}
                  placeholder="Policy UUID"
                  required
                  autoFocus
                />
              </Field>
              <Field label="Ceded contract ID">
                <input
                  id="cessionContractId"
                  value={form.cessionContractId}
                  onChange={update('cessionContractId')}
                  placeholder="Contract UUID"
                  required
                />
              </Field>
              <Field label="Ceded premium">
                <input
                  id="cededPremium"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.cededPremium}
                  onChange={update('cededPremium')}
                  required
                />
              </Field>
              <Field label="Ceded loss">
                <input
                  id="cededLoss"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.cededLoss}
                  onChange={update('cededLoss')}
                  required
                />
              </Field>
              <Field label="Currency">
                <input
                  id="currency"
                  value={form.currency}
                  onChange={update('currency')}
                  maxLength={3}
                  placeholder="USD"
                  required
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeCreate}
                  disabled={createBusy}
                >
                  Cancel
                </button>
                <button type="submit" disabled={createBusy}>
                  {createBusy ? 'Creating…' : 'Create cession'}
                </button>
              </div>
            </form>
            <ErrorText>{error}</ErrorText>
          </section>
        </div>
      )}
    </main>
  );
}
