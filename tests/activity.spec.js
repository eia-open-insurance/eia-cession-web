import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';

const CESSION_A = {
  id: '22222222-2222-7222-8222-222222222222',
  tenantId: TENANT,
  businessBook: 'DIRECT',
  cessionNumber: 'CES-000000001',
  policyId: '33333333-3333-7333-8333-333333333333',
  cessionContractId: '44444444-4444-7444-8444-444444444444',
  status: 'OPEN',
  cededPremium: 750000.0,
  cededLoss: 450000.0,
  currency: 'USD',
  version: 0,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z',
  fsriHandoffId: null,
  fsriStatus: null,
  fsriHandedOffAt: null,
  fsriLastError: null
};

const CESSION_B = {
  ...CESSION_A,
  id: '55555555-5555-7555-8555-555555555555',
  cessionNumber: 'CES-000000002',
  policyId: '66666666-6666-7666-8666-666666666666',
  status: 'RULE_APPLIED',
  version: 1
};

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const ACK_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';

/** One aggregate event in the shape the event service embeds. */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = CESSION_A.id,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'CessionCase',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent(aggregateId = CESSION_A.id) {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'cession.case.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    aggregateId,
    data: {
      caseNumber: CESSION_A.cessionNumber,
      status: 'OPEN',
      version: 0
    }
  });
}

function acknowledgedEvent(aggregateId = CESSION_A.id) {
  return aggregateEvent({
    eventId: ACK_EVENT_ID,
    eventType: 'cession.handoff.acknowledged',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    aggregateId,
    data: { from: 'HANDOFF_PENDING', to: 'HANDED_OFF', version: 1 }
  });
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the cession queue and the aggregate activity endpoint. The queue read is
 * the only other call the workbench makes on selection.
 */
async function mockCessionApi(page, {
  cessions = [CESSION_A],
  onEvents = null,
  eventsBody = { items: [] },
  eventsStatus = 200
} = {}) {
  await page.route('**/api/v1/cessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/v1/cessions') {
      await json(route, 200, cessions);
      return;
    }
    if (request.method() === 'GET') {
      const id = path.split('/').pop();
      const match = cessions.find((cession) => cession.id === id);
      await json(route, match ? 200 : 404, match || { code: 'CESSION_NOT_FOUND' });
      return;
    }
    await json(route, 200, cessions[0]);
  });

  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (onEvents) await onEvents({ route, url, request });
    if (eventsBody) await json(route, eventsStatus, eventsBody);
  });
}

test('loads activity for the selected cession with tenant header, newest first, and refetches on selection', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockCessionApi(page, {
    cessions: [CESSION_A, CESSION_B],
    eventsBody: null,
    onEvents: async ({ route, url, request }) => {
      const position = requests.push({
        method: request.method(),
        path: url.pathname,
        limit: url.searchParams.get('limit'),
        tenant: request.headers()['x-eia-tenant'],
        cessionId: url.pathname.split('/').pop()
      });

      if (position === 1) await firstGate;

      if (url.pathname.endsWith(CESSION_A.id)) {
        // Deliberately oldest-first: the card must present newest-first.
        await json(route, 200, {
          aggregateId: CESSION_A.id,
          limit: 50,
          items: [createdEvent(), acknowledgedEvent()]
        });
        return;
      }
      await json(route, 200, {
        aggregateId: CESSION_B.id,
        limit: 50,
        items: [createdEvent(CESSION_B.id)]
      });
    }
  });

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: CESSION_A.cessionNumber })).toBeVisible();

    // Selection alone fetches the timeline, before the Activity tab is opened.
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/api/v1/events/aggregate/${CESSION_A.id}`,
      limit: '50',
      tenant: TENANT,
      cessionId: CESSION_A.id
    });

    await page.getByRole('tab', { name: 'Activity' }).click();
    const card = page.getByTestId('cession-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Cession hand-off acknowledged');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest.getByTestId('activity-fact-status')).toContainText(
      'HANDOFF_PENDING → HANDED_OFF'
    );
    await expect(newest.getByTestId('activity-fact-version')).toContainText('Version 1');

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Cession case created');
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('OPEN');
    await expect(oldest.getByTestId('activity-fact-version')).toContainText('Version 0');

    // Selecting another cession refetches the timeline for its aggregate id.
    await page
      .locator('.eia-record-list button')
      .filter({ hasText: CESSION_B.cessionNumber })
      .click();
    await expect(page.getByRole('heading', { name: CESSION_B.cessionNumber })).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].path).toBe(`/api/v1/events/aggregate/${CESSION_B.id}`);
    expect(requests[1].tenant).toBe(TENANT);

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
    await expect(card.getByTestId('activity-item')).toHaveCount(1);

    // The card's own Refresh re-reads the same aggregate without changing selection.
    await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2].path).toBe(`/api/v1/events/aggregate/${CESSION_B.id}`);
    expect(requests[2].limit).toBe('50');
    expect(requests[2].tenant).toBe(TENANT);
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  await mockCessionApi(page, {
    eventsBody: { aggregateId: CESSION_A.id, limit: 50, items: [] }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CESSION_A.cessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('cession-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toHaveText(
    'No activity has been recorded for this cession yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(card.getByTestId('activity-context-note')).toContainText('SAP FS-RI');

  // The record itself is untouched by an empty timeline.
  await expect(page.getByTestId('cession-status')).toHaveText('OPEN');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  await mockCessionApi(page, {
    eventsStatus: 503,
    eventsBody: {
      code: 'EVENT_STORE_UNAVAILABLE',
      message: 'Event service unavailable'
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CESSION_A.cessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('cession-activity');
  const error = card.getByTestId('activity-error');
  await expect(error).toContainText('Activity timeline is temporarily unavailable');
  await expect(error).toContainText('Event service unavailable');
  await expect(error).toContainText('The cession record is unaffected.');
  await expect(card.getByTestId('activity-count')).toHaveText('—');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('cession-status')).toHaveText('OPEN');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('USD 750,000.00');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Cession details' })).toBeVisible();
});

test('renders status, FS-RI hand-off, and amount facts from the event payload', async ({ page }) => {
  const ackId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3';
  const rejectedId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4';

  await mockCessionApi(page, {
    eventsBody: {
      aggregateId: CESSION_A.id,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: rejectedId,
          eventType: 'cession.handoff.rejected',
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 3,
          status: 'FAILED',
          data: {
            from: 'HANDOFF_PENDING',
            to: 'REJECTED',
            version: 2,
            cessionNumber: CESSION_A.cessionNumber,
            fsriContractNumber: 'CES-2026-0001',
            reason: 'FS-RI rejected the cession hand-off',
            cededPremium: '750000.0000',
            currency: 'USD'
          }
        }),
        aggregateEvent({
          eventId: ackId,
          eventType: 'cession.handoff.acknowledged',
          occurredAt: '2026-10-19T12:30:00Z',
          aggregateVersion: 2,
          data: {
            from: 'HANDOFF_PENDING',
            to: 'HANDED_OFF',
            version: 1,
            cessionNumber: CESSION_A.cessionNumber,
            fsriHandoffId: 'FSRI-CES-DIRECT-000001',
            fsriStatus: 'POSTED',
            fsriContractNumber: 'CES-2026-0001',
            fsriHandedOffAt: '2026-10-19T12:30:00Z',
            cededPremium: '750000.0000',
            cededLoss: '450000.0000',
            currency: 'USD'
          }
        }),
        createdEvent()
      ]
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CESSION_A.cessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(3);

  const rejection = items.nth(0);
  await expect(rejection.getByTestId('activity-type')).toHaveText('Cession hand-off rejected');
  await expect(rejection.getByTestId('activity-status')).toHaveText('FAILED');
  await expect(rejection.getByTestId('activity-status')).toHaveClass(/red/);
  await expect(rejection.getByTestId('activity-fact-status')).toContainText(
    'HANDOFF_PENDING → REJECTED'
  );
  await expect(rejection.getByTestId('activity-fact-fsri-contract')).toContainText('CES-2026-0001');
  await expect(rejection.getByTestId('activity-fact-fsri-error')).toContainText(
    'Rejection reason FS-RI rejected the cession hand-off'
  );
  await expect(rejection.getByTestId('activity-fact-ceded-premium')).toContainText(
    'Ceded premium USD 750,000.00'
  );

  const acknowledgement = items.nth(1);
  await expect(acknowledgement.getByTestId('activity-type')).toHaveText(
    'Cession hand-off acknowledged'
  );
  await expect(acknowledgement.getByTestId('activity-fact-fsri-handoff')).toContainText(
    'FSRI-CES-DIRECT-000001'
  );
  await expect(acknowledgement.getByTestId('activity-fact-fsri-status')).toContainText('POSTED');
  await expect(acknowledgement.getByTestId('activity-fact-fsri-handoff-at')).toContainText(
    'Oct 19, 2026'
  );
  await expect(acknowledgement.getByTestId('activity-fact-ceded-premium')).toContainText(
    'USD 750,000.00'
  );
  await expect(acknowledgement.getByTestId('activity-fact-ceded-loss')).toContainText(
    'USD 450,000.00'
  );

  const created = items.nth(2);
  await expect(created.getByTestId('activity-type')).toHaveText('Cession case created');
  await expect(created.getByTestId('activity-fact-cession')).toContainText(CESSION_A.cessionNumber);
});
