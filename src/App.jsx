import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import EntityPicker from './EntityPicker.jsx';
import ActivityPanel from './ActivityPanel.jsx';
import NotificationsPanel from './NotificationsPanel.jsx';
import { activityEndpoint, activityItems } from './activity.js';
import {
  cessionNotificationCount,
  cessionNotifications,
  cessionNotificationsEndpoint,
  emptyCessionNotificationsState
} from './notifications.js';
import { navigate, recordHref } from './navigation.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'DIRECT';
const CONTRACT_BOOK = 'ASSUMED';

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
  policyLabel: '',
  policySecondary: '',
  cessionContractId: '',
  contractLabel: '',
  contractSecondary: '',
  cededPremium: '0.0000',
  cededLoss: '0.0000',
  currency: 'USD'
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'handoff', label: 'FS-RI Hand-off' },
  { id: 'history', label: 'Status History' },
  { id: 'activity', label: 'Activity' }
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

/**
 * The Notifications service is tenant-scoped rather than book-scoped, so this
 * read deliberately sends only the tenant header: the DIRECT book wall that
 * applies to cession requests does not apply to delivery artifacts.
 */
async function notificationRequest(path) {
  const response = await fetch(path, { headers: { 'X-EIA-Tenant': TENANT } });
  if (!response.ok) throw new Error(await failureMessage(response));
  if (response.status === 204) return null;
  return response.json();
}

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false };
  const params = new URLSearchParams(window.location.search);
  return { record: params.get('record') || '', create: params.get('new') === '1' };
}

/**
 * The remote is mounted either at the shell route (/cession) or directly at the
 * dev-server root (/). Only treat the URL as cession state on those routes so a
 * cross-link to /policy or /contract is not interpreted as a cession id.
 */
function onCessionsRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/' || path.endsWith('/cession');
}

function writeUrl({ record = '', create = false, replace = false } = {}) {
  if (typeof window === 'undefined' || !onCessionsRoute()) return;
  const params = new URLSearchParams();
  if (record) params.set('record', record);
  if (create) params.set('new', '1');
  const query = params.toString();
  const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (target === current) return;
  try {
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
  } catch {
    // URL state is an enhancement; queue selection still works without it.
  }
}

function filterCessions(cessions, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return cessions;
  return cessions.filter((cession) =>
    [
      cession.cessionNumber,
      cession.policyId,
      cession.cessionContractId,
      cession.status,
      humanize(cession.status)
    ].some((value) => String(value || '').toLowerCase().includes(term))
  );
}

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
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
  const [queueFilter, setQueueFilter] = useState('');
  const [activity, setActivity] = useState({ items: [], loading: false, error: '' });
  const [activityNonce, setActivityNonce] = useState(0);
  const [notifications, setNotifications] = useState(emptyCessionNotificationsState);
  const [notificationsNonce, setNotificationsNonce] = useState(0);

  const cessionsRef = useRef([]);
  const applyingUrlRef = useRef(false);
  const createOpenRef = useRef(false);

  const selectedCession = cessions.find((cession) => cession.id === selectedId) || null;
  const selectedCessionId = selectedCession?.id || null;
  const filteredCessions = filterCessions(cessions, queueFilter);
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
    createOpenRef.current = createOpen;
  }, [createOpen]);

  /**
   * Applies ?record= and ?new=1. The record is selected immediately when it is
   * already in the queue; otherwise the detail endpoint is fetched and the
   * cession is inserted at the top of the queue.
   */
  async function applyUrlState(rows, { initial = false } = {}) {
    if (!onCessionsRoute()) return;
    const { record, create } = readUrlState();

    if (create) {
      if (!createOpenRef.current) setForm(EMPTY_FORM);
      setCreateOpen(true);
      setError('');
      return;
    }

    if (!record) {
      if (!initial) {
        setCreateOpen(false);
        setError('');
      }
      return;
    }

    setCreateOpen(false);
    if (applyingUrlRef.current) return;

    const queue = Array.isArray(rows) && rows.length > 0 ? rows : cessionsRef.current;
    const known = queue.find(
      (cession) => cession.id === record || cession.cessionNumber === record
    );
    if (known) {
      setSelectedId(known.id);
      setError('');
      return;
    }

    if (!UUID_PATTERN.test(record)) {
      setError(`Cession “${record}” was not found in the DIRECT cession queue.`);
      return;
    }

    applyingUrlRef.current = true;
    try {
      const cession = await request(`/api/v1/cessions/${record}`);
      if (cession?.id) {
        setCessions((current) =>
          current.some((row) => row.id === cession.id) ? current : [cession, ...current]
        );
        setSelectedId(cession.id);
        setActiveTab('overview');
        setError('');
      }
    } catch (cause) {
      setError(`Cession ${record} could not be loaded: ${cause.message}`);
      setSelectedId((current) => current || cessionsRef.current[0]?.id || null);
    } finally {
      applyingUrlRef.current = false;
    }
  }

  useEffect(() => {
    let alive = true;
    if (readUrlState().create && onCessionsRoute()) {
      setForm(EMPTY_FORM);
      setCreateOpen(true);
    }

    const onPopState = () => {
      applyUrlState(cessionsRef.current);
    };
    window.addEventListener('popstate', onPopState);

    load()
      .then((rows) => {
        if (!alive) return;
        setLoading(false);
        applyUrlState(rows, { initial: true });
      })
      .catch((cause) => {
        if (!alive) return;
        setLoading(false);
        setError(cause.message);
      });

    return () => {
      alive = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    cessionsRef.current = cessions;
    setSelectedId((current) => {
      if (current && cessions.some((cession) => cession.id === current)) return current;
      const requested = readUrlState().record;
      if (
        requested &&
        !cessions.some(
          (cession) => cession.id === requested || cession.cessionNumber === requested
        )
      ) {
        // Keep waiting for the detail lookup instead of selecting a different cession.
        return current;
      }
      return cessions[0]?.id || null;
    });
  }, [cessions]);

  useEffect(() => {
    setActiveTab('overview');
    setTransitionTarget('');
    setHandoffContractNumber('');
  }, [selectedId]);

  /**
   * Event-derived activity for the selected cession. The fetch starts when the
   * record is selected and owns its own loading/error state, so a slow or
   * unavailable event service never blocks the cession record.
   *
   * Events come from `GET /api/v1/events/aggregate/{cessionId}?limit=50` with the
   * tenant header; they are facts that already happened, not editable state.
   */
  useEffect(() => {
    if (!selectedCessionId) {
      setActivity({ items: [], loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    setActivity({ items: [], loading: true, error: '' });
    request(activityEndpoint(selectedCessionId))
      .then((payload) => {
        if (cancelled) return;
        setActivity({ items: activityItems(payload), loading: false, error: '' });
      })
      .catch((cause) => {
        if (cancelled) return;
        setActivity({ items: [], loading: false, error: cause.message });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCessionId, activityNonce]);

  /**
   * Related notifications for the selected cession. Notifications are delivery
   * artifacts owned by the Notifications vertical, so this is a read-only
   * projection: the fetch starts after the record is on screen and owns its own
   * loading/error state, and a slow or unavailable Notifications service never
   * blocks or fails the cession record.
   */
  useEffect(() => {
    if (!selectedCessionId) {
      setNotifications(emptyCessionNotificationsState());
      return undefined;
    }
    let cancelled = false;
    setNotifications({ items: [], count: 0, loading: true, error: '' });
    notificationRequest(cessionNotificationsEndpoint(selectedCessionId))
      .then((payload) => {
        if (cancelled) return;
        const items = cessionNotifications(payload, selectedCessionId);
        setNotifications({
          items,
          count: cessionNotificationCount(payload, items),
          loading: false,
          error: ''
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setNotifications({
          items: [],
          count: 0,
          loading: false,
          error: cause.message
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCessionId, notificationsNonce]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !createBusy) {
        setCreateOpen(false);
        setError('');
        writeUrl({ record: selectedCessionId || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, createBusy, selectedCessionId]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function selectPolicy(id, item) {
    setForm((current) => ({
      ...current,
      policyId: id,
      policyLabel: item?.label || '',
      policySecondary: item?.secondary || ''
    }));
  }

  function selectContract(id, item) {
    setForm((current) => ({
      ...current,
      cessionContractId: id,
      contractLabel: item?.label || '',
      contractSecondary: item?.secondary || ''
    }));
  }

  function selectCession(cession) {
    if (cession.id !== selectedId) setSelectedId(cession.id);
    setError('');
    setNotice('');
    writeUrl({ record: cession.id });
  }

  async function refresh() {
    setError('');
    setActivityNonce((value) => value + 1);
    setNotificationsNonce((value) => value + 1);
    try {
      await load();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function refreshActivity() {
    setActivityNonce((value) => value + 1);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError('');
    setNotice('');
    setCreateOpen(true);
    writeUrl({ create: true });
  }

  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
    setError('');
    writeUrl({ record: selectedCessionId || '' });
  }

  async function submitCreate(event) {
    event.preventDefault();
    setError('');
    if (!form.policyId || !form.cessionContractId) {
      setError('Select a DIRECT policy and an ASSUMED cession contract before creating the cession.');
      return;
    }

    setCreateBusy(true);
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
      setActivityNonce((value) => value + 1);
      if (created?.id) {
        setSelectedId(created.id);
        writeUrl({ record: created.id });
      }
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
      setActivityNonce((value) => value + 1);
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
      setActivityNonce((value) => value + 1);
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div
            className="eia-queue-search"
            role="search"
            aria-label="Filter the cession queue"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div className="eia-search-box" style={{ height: 38, flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder="Filter cessions by number, policy, contract, or status…"
                aria-label="Filter cessions by number, policy, contract, or status"
                autoComplete="off"
                data-testid="cession-filter"
              />
            </div>
            {queueFilter && (
              <button type="button" className="eia-btn-ghost" onClick={() => setQueueFilter('')}>
                Clear
              </button>
            )}
          </div>

          <aside className="eia-record-list" aria-label="Cession queue">
            <div className="eia-record-list-head">
              <strong>Cession queue</strong>
              <span className="eia-muted" data-testid="cession-queue-count">
                {loading
                  ? '…'
                  : queueFilter
                    ? `${filteredCessions.length} of ${cessions.length}`
                    : cessions.length}
              </span>
            </div>
            {filteredCessions.map((cession) => (
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
            {!loading && cessions.length > 0 && filteredCessions.length === 0 && (
              <div className="empty">
                No cessions match “{queueFilter.trim()}”. Clear the filter to see the full queue.
              </div>
            )}
            {!loading && cessions.length === 0 && (
              <div className="empty">No cession cases on the DIRECT book yet.</div>
            )}
            {loading && <div className="empty">Loading the DIRECT cession queue…</div>}
          </aside>
        </div>

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
                        <dd>
                          {selectedCession.policyId ? (
                            <>
                              <a
                                href={recordHref('policy', selectedCession.policyId)}
                                onClick={openRecord}
                                data-testid="overview-policy-link"
                              >
                                Open policy record
                              </a>
                              <span className="eia-mono" style={{ marginLeft: 6 }}>
                                {shortId(selectedCession.policyId)}
                              </span>
                            </>
                          ) : '—'}
                        </dd>
                        <dt>Ceded contract</dt>
                        <dd>
                          {selectedCession.cessionContractId ? (
                            <>
                              <a
                                href={recordHref('contract', selectedCession.cessionContractId)}
                                onClick={openRecord}
                                data-testid="overview-contract-link"
                              >
                                Open cession contract record
                              </a>
                              <span className="eia-mono" style={{ marginLeft: 6 }}>
                                {shortId(selectedCession.cessionContractId)}
                              </span>
                            </>
                          ) : '—'}
                        </dd>
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

                  <NotificationsPanel
                    cessionId={selectedCessionId}
                    items={notifications.items}
                    count={notifications.count}
                    loading={notifications.loading}
                    error={notifications.error}
                  />

                  <section className="eia-context-panel" aria-label="Why this matters">
                    <h4>Why this matters</h4>
                    <p>
                      A cession is the DIRECT-book outward reinsurance record for a policy: the expected
                      ceded premium and loss, the cession lifecycle, and the FS-RI hand-off. The policy
                      and contract are owned upstream and linked here, not edited on the cession. SAP FS-RI
                      owns the actual ceded amounts, recoverables, and statements, so
                      the FS-RI hand-off is the operative step that moves the case into that system of
                      record.
                    </p>
                    <div className="links">
                      {selectedCession.policyId && (
                        <a
                          href={recordHref('policy', selectedCession.policyId)}
                          onClick={openRecord}
                          data-testid="why-policy-link"
                        >
                          Policy record
                        </a>
                      )}
                      {selectedCession.cessionContractId && (
                        <a
                          href={recordHref('contract', selectedCession.cessionContractId)}
                          onClick={openRecord}
                          data-testid="why-contract-link"
                        >
                          Cession contract record
                        </a>
                      )}
                      <a
                        href="#cession-panel-handoff"
                        onClick={(event) => {
                          event.preventDefault();
                          setActiveTab('handoff');
                        }}
                        data-testid="why-handoff-link"
                      >
                        Go to the FS-RI hand-off
                      </a>
                    </div>
                  </section>
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

              {activeTab === 'activity' && (
                <ActivityPanel
                  items={activity.items}
                  loading={activity.loading}
                  error={activity.error}
                  onRefresh={refreshActivity}
                />
              )}
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
                  Create a cession case for a DIRECT policy and an ASSUMED cession contract. The cession
                  request itself is walled to the DIRECT book.
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
              <Field label="Policy" className="span-2">
                <EntityPicker
                  endpoint="/api/v1/policies/search"
                  book={BOOK}
                  value={form.policyId}
                  valueLabel={form.policyLabel}
                  onChange={selectPolicy}
                  placeholder="Search policy number or product…"
                  disabled={createBusy}
                />
                {form.policyId && (
                  <span className="eia-picker-hint">
                    {form.policySecondary || 'Policy selected'} ·{' '}
                    <a
                      href={recordHref('policy', form.policyId)}
                      onClick={openRecord}
                      data-testid="create-policy-link"
                    >
                      Open policy record
                    </a>
                  </span>
                )}
              </Field>
              <Field label="Cession contract">
                <EntityPicker
                  endpoint="/api/v1/contracts/search"
                  book={CONTRACT_BOOK}
                  value={form.cessionContractId}
                  valueLabel={form.contractLabel}
                  onChange={selectContract}
                  placeholder="Search contract number or cedent…"
                  disabled={createBusy}
                />
                {form.cessionContractId && (
                  <span className="eia-picker-hint">
                    {form.contractSecondary || 'Cession contract selected'} ·{' '}
                    <a
                      href={recordHref('contract', form.cessionContractId)}
                      onClick={openRecord}
                      data-testid="create-contract-link"
                    >
                      Open cession contract record
                    </a>
                  </span>
                )}
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
