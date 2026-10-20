import React from 'react';
import {
  eventStatusTone,
  formatEventTimestamp,
  payloadFacts,
  readableEventType
} from './activity.js';

function ActivityItem({ event }) {
  const status = event?.status ? String(event.status) : 'UNKNOWN';
  const facts = payloadFacts(event);

  return (
    <li className="eia-timeline-item" data-testid="activity-item">
      <div className="eia-timeline-head">
        <time
          className="eia-activity-time"
          dateTime={event?.occurredAt || undefined}
          title={event?.occurredAt || undefined}
          data-testid="activity-time"
        >
          {formatEventTimestamp(event?.occurredAt)}
        </time>
        <strong
          className="eia-activity-type"
          title={event?.eventType || undefined}
          data-testid="activity-type"
        >
          {readableEventType(event?.eventType)}
        </strong>
        <span className={`eia-pill ${eventStatusTone(status)}`} data-testid="activity-status">
          {status}
        </span>
      </div>
      {facts.length > 0 && (
        <ul className="eia-activity-facts" aria-label="Event payload summary">
          {facts.map((fact) => (
            <li
              key={fact.key}
              className="eia-activity-fact"
              data-testid={`activity-fact-${fact.key}`}
            >
              <span className="eia-activity-fact-label">{fact.label}</span> <b>{fact.value}</b>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Event-derived activity for the selected cession case. The card owns its own
 * loading, error, and empty states: a slow or unavailable event service never
 * blocks the cession record or turns into a page-level alert.
 */
export default function ActivityPanel({ items = [], loading = false, error = '', onRefresh }) {
  const countLabel = loading
    ? '…'
    : error
      ? '—'
      : `${items.length} ${items.length === 1 ? 'event' : 'events'}`;

  return (
    <section
      id="cession-panel-activity"
      role="tabpanel"
      aria-labelledby="cession-tab-activity"
      data-testid="cession-activity"
    >
      <section className="eia-card eia-activity" aria-label="Activity timeline">
        <div className="eia-section-title" style={{ marginTop: 0 }}>
          <h2>Activity</h2>
          <span className="eia-muted" data-testid="activity-count">{countLabel}</span>
        </div>

        <div className="eia-toolbar" style={{ marginTop: 0, marginBottom: 4 }}>
          <span className="spacer" />
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={() => {
              if (onRefresh) onRefresh();
            }}
            disabled={loading}
            aria-label="Refresh activity timeline"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <p
          className="eia-muted eia-activity-note"
          data-testid="activity-context-note"
          style={{ margin: 0 }}
        >
          Event-derived timeline: entries come from immutable cession events, are append-only, and
          are never edited or removed. The cession record remains the source of truth for the
          expected amounts and the stored FS-RI acknowledgement; SAP FS-RI remains the system of
          record for the actual ceded amounts.
        </p>

        {loading && (
          <p className="eia-muted" data-testid="activity-loading" style={{ margin: '12px 0 0' }}>
            Loading activity…
          </p>
        )}
        {!loading && error && (
          <p className="eia-muted" data-testid="activity-error" style={{ margin: '12px 0 0' }}>
            Activity timeline is temporarily unavailable ({error}). The cession record is
            unaffected.
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 12 }}>
            No activity has been recorded for this cession yet.
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <ol className="eia-timeline" data-testid="activity-timeline" aria-label="Cession activity timeline">
            {items.map((event, index) => (
              <ActivityItem key={event?.eventId || `activity-${index}`} event={event} />
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
