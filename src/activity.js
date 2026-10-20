/**
 * Cession activity helpers.
 *
 * The platform event-ingest service exposes the append-only event stream for one
 * aggregate: `GET /api/v1/events/aggregate/{cessionId}?limit=50` with the tenant
 * in `X-EIA-Tenant`. An event is a fact that already happened; the cession record
 * remains the source of truth for the current status, the expected ceded amounts,
 * and the stored FS-RI acknowledgement, and nothing in this timeline can change
 * them. SAP FS-RI remains the system of record for the actual ceded amounts.
 */

export const ACTIVITY_LIMIT = 50;

/** Builds GET /api/v1/events/aggregate/{cessionId}?limit=… for one cession case. */
export function activityEndpoint(cessionId, limit = ACTIVITY_LIMIT) {
  const id = String(cessionId || '').trim();
  if (!id) return '';
  return `/api/v1/events/aggregate/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}`;
}

const WORD_SEPARATOR = /[._\-\s]+/;

/** Event-name tokens that read better with their business spelling. */
const DISPLAY_TOKENS = {
  handoff: 'hand-off',
  fsri: 'FS-RI'
};

/**
 * Turns `cession.handoff.acknowledged` into “Cession hand-off acknowledged”.
 * Adjacent repeated tokens are collapsed so the vertical prefix does not
 * stutter, and every separator style used by event names becomes a word break.
 */
export function readableEventType(eventType) {
  const words = String(eventType || '')
    .split(WORD_SEPARATOR)
    .map((word) => word.trim())
    .filter(Boolean);

  const deduped = [];
  for (const word of words) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.toLowerCase() === word.toLowerCase()) continue;
    deduped.push(word);
  }

  if (deduped.length === 0) return 'Cession event';
  return deduped
    .map((word, index) => {
      const lower = word.toLowerCase();
      const display = DISPLAY_TOKENS[lower] || lower;
      return index === 0 ? `${display.charAt(0).toUpperCase()}${display.slice(1)}` : display;
    })
    .join(' ');
}

/** Event delivery/processing status tone, distinct from the cession status. */
export function eventStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (['PROCESSED', 'APPLIED', 'ACCEPTED', 'CONFIRMED', 'COMPLETE', 'COMPLETED', 'SUCCEEDED'].includes(value)) {
    return 'green';
  }
  if (['FAILED', 'REJECTED', 'ERROR', 'DEAD_LETTERED', 'DEAD_LETTER'].includes(value)) {
    return 'red';
  }
  if (['RECEIVED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'HELD', 'QUARANTINED'].includes(value)) {
    return 'amber';
  }
  return 'blue';
}

export function formatEventTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const stamp = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
  return `${stamp} UTC`;
}

/** Matches the cession workbench money rendering ("USD 750,000.00"). */
export function formatEventAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '';
  const numeric = Number(amount);
  const text = Number.isFinite(numeric)
    ? numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(amount);
  return currency ? `${currency} ${text}` : text;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readPath(source, path) {
  let current = source;
  for (const segment of path.split('.')) {
    const object = asObject(current);
    if (!object || !Object.prototype.hasOwnProperty.call(object, segment)) return undefined;
    current = object[segment];
  }
  return current;
}

function textValue(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * The event service embeds the canonical envelope in `payload` and the cession
 * facts live in its `data` object. Tests and future projections may also send
 * the data object directly, so both shapes are accepted.
 */
export function eventData(event) {
  const payload = asObject(event?.payload);
  if (!payload) return {};
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function occurredAtMillis(event) {
  const occurred = Date.parse(event?.occurredAt);
  if (Number.isFinite(occurred)) return occurred;
  const received = Date.parse(event?.receivedAt);
  return Number.isFinite(received) ? received : 0;
}

function aggregateVersion(event) {
  const version = Number(event?.aggregateVersion);
  return Number.isFinite(version) ? version : -1;
}

/**
 * Accepts the `{ items }` page (or a bare array) and returns newest-first,
 * non-null events. Ties fall back to aggregate version and event id so the
 * rendering order is deterministic even when two events share a timestamp.
 */
export function activityItems(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort((left, right) => {
      const byTime = occurredAtMillis(right) - occurredAtMillis(left);
      if (byTime !== 0) return byTime;
      const byVersion = aggregateVersion(right) - aggregateVersion(left);
      if (byVersion !== 0) return byVersion;
      return String(left?.eventId || '').localeCompare(String(right?.eventId || ''));
    });
}

function errorLabel(eventType) {
  return String(eventType || '').toLowerCase().includes('reject')
    ? 'Rejection reason'
    : 'FS-RI error';
}

/**
 * The business facts a cession event carries: the status transition, the case
 * version, the FS-RI hand-off reference and status, and the expected ceded
 * amounts. Absent facts are omitted rather than rendered blank, because not
 * every event type carries every fact.
 */
export function payloadFacts(event) {
  const data = eventData(event);
  const facts = [];

  const from = textValue(data, ['from', 'fromStatus', 'previousStatus', 'oldStatus', 'status.from']);
  const to = textValue(data, ['to', 'toStatus', 'newStatus', 'status.to']);
  const currentStatus = textValue(data, ['status', 'caseStatus', 'cessionStatus']);
  if (from && to) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (from) {
    facts.push({ key: 'status', label: 'Status', value: `${from} →` });
  } else if (to || currentStatus) {
    facts.push({ key: 'status', label: 'Status', value: to || currentStatus });
  }

  const version = textValue(data, ['caseVersion', 'cessionVersion', 'versionNumber', 'version'])
    || (event?.aggregateVersion !== null && event?.aggregateVersion !== undefined
      ? String(event.aggregateVersion)
      : '');
  if (version) {
    facts.push({ key: 'version', label: 'Version', value: version });
  }

  const cessionNumber = textValue(data, ['cessionNumber', 'caseNumber', 'cession.caseNumber']);
  if (cessionNumber) {
    facts.push({ key: 'cession', label: 'Cession', value: cessionNumber });
  }

  const currency = textValue(data, ['currency', 'cededCurrency']);

  const cededPremium = textValue(data, [
    'cededPremium',
    'cededPremiumAmount',
    'expectedCededPremium',
    'amounts.cededPremium'
  ]);
  if (cededPremium) {
    facts.push({
      key: 'ceded-premium',
      label: 'Ceded premium',
      value: formatEventAmount(cededPremium, currency)
    });
  }

  const cededLoss = textValue(data, ['cededLoss', 'cededLossAmount', 'expectedCededLoss', 'amounts.cededLoss']);
  if (cededLoss) {
    facts.push({
      key: 'ceded-loss',
      label: 'Ceded loss',
      value: formatEventAmount(cededLoss, currency)
    });
  }

  const expectedAmount = textValue(data, [
    'expectedCededAmount',
    'expectedAmount',
    'confirmedCededAmount',
    'amounts.expectedCededAmount'
  ]);
  const sameAmount = (left, right) => (
    Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right)
  );
  if (expectedAmount && !sameAmount(expectedAmount, cededPremium) && !sameAmount(expectedAmount, cededLoss)) {
    facts.push({
      key: 'expected-amount',
      label: 'Expected ceded amount',
      value: formatEventAmount(expectedAmount, currency)
    });
  }

  const handoffId = textValue(data, ['fsriHandoffId', 'fsriCessionId', 'handoffId', 'handoff.id']);
  if (handoffId) {
    facts.push({ key: 'fsri-handoff', label: 'FS-RI hand-off', value: handoffId });
  }

  const fsriStatus = textValue(data, ['fsriStatus', 'handoff.status']);
  if (fsriStatus) {
    facts.push({ key: 'fsri-status', label: 'FS-RI status', value: fsriStatus });
  }

  const fsriContract = textValue(data, ['fsriContractNumber', 'handoff.fsriContractNumber']);
  if (fsriContract) {
    facts.push({ key: 'fsri-contract', label: 'FS-RI contract', value: fsriContract });
  }

  const handedOffAt = textValue(data, ['fsriHandedOffAt', 'handoff.sentAt']);
  if (handedOffAt) {
    facts.push({
      key: 'fsri-handoff-at',
      label: 'Handed off at',
      value: formatEventTimestamp(handedOffAt)
    });
  }

  const fsriError = textValue(data, ['fsriLastError', 'error', 'handoff.error']);
  if (fsriError) {
    facts.push({ key: 'fsri-error', label: errorLabel(event?.eventType), value: fsriError });
  } else {
    const reason = textValue(data, ['reason', 'rejectionReason', 'failureReason']);
    if (reason) {
      facts.push({ key: 'fsri-error', label: errorLabel(event?.eventType), value: reason });
    }
  }

  return facts;
}
