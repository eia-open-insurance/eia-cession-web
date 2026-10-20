import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = '33333333-3333-7333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-7444-8444-444444444444';
const OTHER_POLICY_ID = '33333333-3333-7333-8333-333333333334';
const OTHER_CONTRACT_ID = '44444444-4444-7444-8444-444444444445';

const CESSION_A = {
  id: '22222222-2222-7222-8222-222222222221',
  tenantId: TENANT,
  businessBook: 'DIRECT',
  cessionNumber: 'CES-2026-0000001',
  policyId: POLICY_ID,
  cessionContractId: CONTRACT_ID,
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
  id: '22222222-2222-7222-8222-222222222222',
  cessionNumber: 'CES-2026-0000002',
  policyId: OTHER_POLICY_ID,
  cessionContractId: OTHER_CONTRACT_ID,
  status: 'HANDOFF_PENDING',
  cededPremium: 120000.0,
  cededLoss: 60000.0
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the cession queue, creation, and detail routes. `detail` maps an id to
 * the record returned by GET /api/v1/cessions/{id}; unknown ids return 404.
 */
async function mockCessions(page, { queue = [], detail = {}, onDetail, onCreate } = {}) {
  let rows = [...queue];

  await page.route('**/api/v1/cessions', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await fulfillJson(route, rows);
      return;
    }
    const payload = request.postDataJSON();
    if (onCreate) onCreate(payload, request);
    const created = {
      ...CESSION_A,
      ...payload,
      id: '22222222-2222-7222-8222-222222222299',
      tenantId: TENANT,
      businessBook: 'DIRECT',
      cessionNumber: 'CES-2026-0000099',
      status: 'OPEN',
      version: 0,
      createdAt: '2026-10-19T12:05:00Z',
      updatedAt: '2026-10-19T12:05:00Z',
      fsriHandoffId: null,
      fsriStatus: null,
      fsriHandedOffAt: null,
      fsriLastError: null
    };
    rows = [created, ...rows];
    await fulfillJson(route, created, 201);
  });

  await page.route('**/api/v1/cessions/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (onDetail) onDetail(request, url);
    const marker = '/api/v1/cessions/';
    const rest = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    const [id, section] = rest.split('/');

    if (request.method() === 'GET' && !section && detail[id]) {
      await fulfillJson(route, detail[id]);
      return;
    }
    if (request.method() === 'GET') {
      await fulfillJson(route, []);
      return;
    }
    await fulfillJson(route, {});
  });
}

async function mockPickers(page, pickerRequests) {
  await page.route('**/api/v1/policies/search**', async (route) => {
    const url = new URL(route.request().url());
    pickerRequests.push({
      path: url.pathname,
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      book: route.request().headers()['x-eia-book']
    });
    await fulfillJson(route, {
      query: 'POL',
      limit: 8,
      items: [
        {
          id: POLICY_ID,
          type: 'POLICY',
          label: 'POL-2026-0001',
          secondary: 'GL · ACTIVE',
          status: 'ACTIVE',
          href: `/policy?record=${POLICY_ID}`
        }
      ]
    });
  });
  await page.route('**/api/v1/contracts/search**', async (route) => {
    const url = new URL(route.request().url());
    pickerRequests.push({
      path: url.pathname,
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      book: route.request().headers()['x-eia-book']
    });
    await fulfillJson(route, {
      query: 'CTR',
      limit: 8,
      items: [
        {
          id: CONTRACT_ID,
          type: 'CONTRACT',
          label: 'CTR-2026-0001',
          secondary: 'Meridian Re · ASSUMED',
          status: 'BOUND',
          href: `/contract?record=${CONTRACT_ID}`
        }
      ]
    });
  });
}

test('?record= selects the requested cession and popstate re-applies it', async ({ page }) => {
  const detailRequests = [];
  await mockCessions(page, {
    queue: [CESSION_A],
    detail: { [CESSION_B.id]: CESSION_B },
    onDetail: (request, url) => {
      if (url.pathname === `/api/v1/cessions/${CESSION_B.id}`) {
        detailRequests.push({
          method: request.method(),
          book: request.headers()['x-eia-book']
        });
      }
    }
  });

  await page.goto(`/?record=${CESSION_B.id}`);

  await expect(page.getByRole('heading', { name: CESSION_B.cessionNumber })).toBeVisible();
  await expect(page.getByRole('button', { name: /CES-2026-0000002/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CES-2026-0000001/ })).toBeVisible();
  expect(detailRequests).toEqual([{ method: 'GET', book: 'DIRECT' }]);

  await page.evaluate((id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('record', id);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, CESSION_A.id);

  await expect(page.getByRole('heading', { name: CESSION_A.cessionNumber })).toBeVisible();
});

test('?new=1 opens the Create cession dialog', async ({ page }) => {
  await mockCessions(page, { queue: [CESSION_A] });

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create cession' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);
});

test('filters the cession queue by number, policy, contract, and status', async ({ page }) => {
  await mockCessions(page, { queue: [CESSION_A, CESSION_B] });

  await page.goto('/');
  const queue = page.locator('aside[aria-label="Cession queue"]');
  const filter = page.getByPlaceholder('Filter cessions by number, policy, contract, or status…');
  const cessionA = queue.getByRole('button', { name: /CES-2026-0000001/ });
  const cessionB = queue.getByRole('button', { name: /CES-2026-0000002/ });

  await expect(cessionA).toBeVisible();
  await expect(cessionB).toBeVisible();
  await expect(page.getByTestId('cession-queue-count')).toHaveText('2');

  for (const term of [OTHER_POLICY_ID, OTHER_CONTRACT_ID, 'HANDOFF_PENDING', 'CES-2026-0000002']) {
    await filter.fill(term);
    await expect(cessionB).toBeVisible();
    await expect(cessionA).toHaveCount(0);
  }

  await filter.fill('CES-2026-0000001');
  await expect(cessionA).toBeVisible();
  await expect(cessionB).toHaveCount(0);
  await expect(page.getByTestId('cession-queue-count')).toHaveText('1 of 2');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(cessionA).toBeVisible();
  await expect(cessionB).toBeVisible();
  await expect(page.getByTestId('cession-queue-count')).toHaveText('2');
});

test('policy and cession contract pickers submit the selected UUIDs', async ({ page }) => {
  const pickerRequests = [];
  let createBody = null;
  await mockCessions(page, {
    queue: [CESSION_A],
    onCreate: (payload) => {
      createBody = payload;
    }
  });
  await mockPickers(page, pickerRequests);

  await page.goto('/');
  await page.getByRole('button', { name: 'Create cession' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByPlaceholder('Search policy number or product…').fill('POL-2026');
  await dialog.getByRole('button', { name: /POL-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open policy record' })).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(dialog.getByText('GL · ACTIVE', { exact: false })).toBeVisible();

  await dialog.getByPlaceholder('Search contract number or cedent…').fill('CTR-2026');
  await dialog.getByRole('button', { name: /CTR-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open cession contract record' })).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_ID}`
  );
  await expect(dialog.getByText('Meridian Re · ASSUMED', { exact: false })).toBeVisible();

  await dialog.getByLabel('Ceded premium').fill('125000.5');
  await dialog.getByLabel('Ceded loss').fill('25000.25');
  await dialog.getByLabel('Currency').fill('usd');
  await dialog.getByRole('button', { name: 'Create cession' }).click();

  await expect(dialog).toBeHidden();
  expect(createBody.policyId).toBe(POLICY_ID);
  expect(createBody.cessionContractId).toBe(CONTRACT_ID);
  expect(createBody.cededPremium).toBe(125000.5);
  expect(createBody.cededLoss).toBe(25000.25);
  expect(createBody.currency).toBe('USD');
  expect(pickerRequests).toEqual([
    { path: '/api/v1/policies/search', q: 'POL-2026', limit: '8', book: 'DIRECT' },
    { path: '/api/v1/contracts/search', q: 'CTR-2026', limit: '8', book: 'ASSUMED' }
  ]);
});

test('overview carries policy/contract cross-links and the why-it-matters context', async ({ page }) => {
  await mockCessions(page, { queue: [CESSION_A] });

  await page.goto('/');

  await expect(page.getByTestId('overview-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByTestId('overview-contract-link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_ID}`
  );

  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  await expect(page.getByText(/DIRECT-book outward reinsurance/i)).toBeVisible();
  await expect(page.getByText(/SAP FS-RI owns the actual ceded amounts/i)).toBeVisible();
  await expect(page.getByText(/FS-RI hand-off is the operative step/i)).toBeVisible();

  await expect(page.getByTestId('why-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByTestId('why-contract-link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_ID}`
  );

  await page.getByTestId('why-handoff-link').click();
  await expect(page.locator('#cession-panel-handoff')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FS-RI hand-off', exact: true })).toBeVisible();
});
