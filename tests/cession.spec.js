import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const EXISTING = {
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

function recordTransition(cessions, path, payload, transitionedAt) {
  const id = path.split('/').at(-2);
  const current = cessions.find((cession) => cession.id === id);
  const handledOff = payload.targetStatus === 'HANDOFF_PENDING';
  const updated = {
    ...current,
    status: handledOff ? 'HANDED_OFF' : payload.targetStatus,
    version: current.version + 1,
    updatedAt: transitionedAt,
    ...(handledOff
      ? {
          fsriHandoffId: 'FSRI-CES-DIRECT-000001',
          fsriStatus: 'POSTED',
          fsriHandedOffAt: transitionedAt
        }
      : {})
  };
  return { updated, next: cessions.map((cession) => (cession.id === id ? updated : cession)) };
}

test('renders the Cession operational record and creates a DIRECT cession', async ({ page }) => {
  let cessions = [EXISTING];
  let createdPayload = null;
  const bookHeaders = [];

  await page.route('**/api/v1/cessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    bookHeaders.push(request.headers()['x-eia-book']);

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cessions)
      });
      return;
    }

    if (path.endsWith('/transition')) {
      const { updated, next } = recordTransition(
        cessions,
        path,
        request.postDataJSON(),
        '2026-10-19T12:30:00Z'
      );
      cessions = next;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated)
      });
      return;
    }

    createdPayload = request.postDataJSON();
    const created = {
      ...EXISTING,
      ...createdPayload,
      id: '22222222-2222-7222-8222-222222222223',
      cessionNumber: 'CES-000000002',
      status: 'OPEN',
      version: 0,
      createdAt: '2026-10-19T12:05:00Z',
      updatedAt: '2026-10-19T12:05:00Z',
      fsriHandoffId: null,
      fsriStatus: null,
      fsriHandedOffAt: null,
      fsriLastError: null
    };
    cessions = [created, ...cessions];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created)
    });
  });

  await page.route('**/api/v1/policies/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'POL',
        limit: 8,
        items: [
          {
            id: '33333333-3333-7333-8333-333333333333',
            type: 'POLICY',
            label: 'POL-2026-0001',
            secondary: 'GL · ACTIVE',
            status: 'ACTIVE',
            href: '/policy?record=33333333-3333-7333-8333-333333333333'
          }
        ]
      })
    });
  });

  await page.route('**/api/v1/contracts/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'CTR',
        limit: 8,
        items: [
          {
            id: '44444444-4444-7444-8444-444444444444',
            type: 'CONTRACT',
            label: 'CTR-2026-0001',
            secondary: 'Meridian Re · ASSUMED',
            status: 'BOUND',
            href: '/contract?record=44444444-4444-7444-8444-444444444444'
          }
        ]
      })
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Cession', exact: true })).toBeVisible();
  await expect(page.getByText('Reinsurance · Direct book')).toBeVisible();
  await expect(page.getByTestId('book-badge')).toHaveText('DIRECT book');
  await expect(page.getByRole('button', { name: /CES-000000001/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CES-000000001' })).toBeVisible();
  await expect(page.getByTestId('cession-status')).toHaveText('OPEN');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('USD 750,000.00');
  await expect(page.getByTestId('summary-ceded-loss')).toHaveText('USD 450,000.00');
  await expect(page.getByTestId('summary-fsri-status')).toHaveText('Not handed off');
  await expect(page.getByTestId('summary-handoff-ref')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Hand off to FS-RI' })).toBeDisabled();

  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'FS-RI Hand-off' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Status History' })).toBeVisible();

  await page.getByRole('button', { name: 'Create cession' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search policy number or product…').fill('POL-2026');
  await dialog.getByRole('button', { name: /POL-2026-0001/ }).click();
  await dialog.getByPlaceholder('Search contract number or cedent…').fill('CTR-2026');
  await dialog.getByRole('button', { name: /CTR-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open policy record' })).toHaveAttribute(
    'href',
    '/policy?record=33333333-3333-7333-8333-333333333333'
  );
  await expect(dialog.getByRole('link', { name: 'Open cession contract record' })).toHaveAttribute(
    'href',
    '/contract?record=44444444-4444-7444-8444-444444444444'
  );
  await dialog.getByLabel('Ceded premium').fill('125000.5');
  await dialog.getByLabel('Ceded loss').fill('25000.25');
  await dialog.getByLabel('Currency').fill('usd');
  await dialog.getByRole('button', { name: 'Create cession' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'CES-000000002' })).toBeVisible();
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('USD 125,000.50');
  await expect(page.getByTestId('summary-ceded-loss')).toHaveText('USD 25,000.25');
  expect(createdPayload).toEqual({
    policyId: '33333333-3333-7333-8333-333333333333',
    cessionContractId: '44444444-4444-7444-8444-444444444444',
    cededPremium: 125000.5,
    cededLoss: 25000.25,
    currency: 'USD'
  });

  await page.getByRole('tab', { name: 'Status History' }).click();
  await expect(page.getByTestId('status-history')).toContainText('Cession created');
  await expect(page.getByTestId('status-history')).toContainText('Lifecycle status recorded');

  expect(bookHeaders.length).toBeGreaterThan(1);
  expect(bookHeaders.every((value) => value === 'DIRECT')).toBeTruthy();
});

test('drives the lifecycle and records FS-RI hand-off fields on the DIRECT book', async ({ page }) => {
  let cessions = [EXISTING];
  const transitions = [];
  const bookHeaders = [];

  await page.route('**/api/v1/cessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    bookHeaders.push(request.headers()['x-eia-book']);

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cessions)
      });
      return;
    }

    const payload = request.postDataJSON();
    transitions.push(payload);
    const { updated, next } = recordTransition(
      cessions,
      path,
      payload,
      '2026-10-19T12:30:00Z'
    );
    cessions = next;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated)
    });
  });

  await page.goto('/');
  await expect(page.getByTestId('cession-status')).toHaveText('OPEN');

  await page.getByLabel('Transition to').selectOption('RULE_APPLIED');
  await page.getByRole('button', { name: 'Apply transition' }).click();
  await expect(page.getByTestId('cession-status')).toHaveText('RULE_APPLIED');
  await expect(page.getByRole('button', { name: 'Hand off to FS-RI' })).toBeEnabled();

  await page.getByRole('tab', { name: 'FS-RI Hand-off' }).click();
  const handoffPanel = page.locator('#cession-panel-handoff');
  await expect(handoffPanel.getByRole('heading', { name: 'FS-RI hand-off', exact: true })).toBeVisible();
  await handoffPanel.getByLabel('FS-RI contract number (optional)').fill('CES-2026-0001');
  await handoffPanel.getByRole('button', { name: 'Hand off to FS-RI' }).click();

  await expect(page.getByTestId('cession-status')).toHaveText('HANDED_OFF');
  await expect(page.getByTestId('summary-fsri-status')).toHaveText('POSTED');
  await expect(page.getByTestId('summary-handoff-ref')).toHaveText('FSRI-CES-DIRECT-000001');
  await expect(page.getByRole('region', { name: 'FS-RI hand-off record' })).toContainText(
    'FSRI-CES-DIRECT-000001'
  );

  await page.getByRole('tab', { name: 'Status History' }).click();
  const history = page.getByTestId('status-history');
  await expect(history).toContainText('Cession created');
  await expect(history).toContainText('FS-RI hand-off acknowledged');
  await expect(history).toContainText('FSRI-CES-DIRECT-000001');

  expect(transitions[0]).toEqual({ targetStatus: 'RULE_APPLIED' });
  expect(transitions[1]).toEqual({
    targetStatus: 'HANDOFF_PENDING',
    fsriContractNumber: 'CES-2026-0001'
  });
  expect(bookHeaders.length).toBeGreaterThan(1);
  expect(bookHeaders.every((value) => value === 'DIRECT')).toBeTruthy();
});
