import { test, expect } from '@playwright/test';

test('renders the DIRECT-book cession workbench with a mocked cession', async ({ page }) => {
  await page.route('**/api/v1/cessions**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '22222222-2222-7222-8222-222222222222',
            tenantId: '11111111-1111-7111-8111-111111111111',
            businessBook: 'DIRECT',
            cessionNumber: 'CES-000000001',
            policyId: '33333333-3333-7333-8333-333333333333',
            cessionContractId: '44444444-4444-7444-8444-444444444444',
            status: 'OPEN',
            cededPremium: 750000.0000,
            cededLoss: 450000.0000,
            currency: 'USD',
            version: 0,
            createdAt: '2026-10-19T12:00:00Z',
            updatedAt: '2026-10-19T12:00:00Z'
          }
        ])
      });
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Cession workbench' })).toBeVisible();
  await expect(page.getByTestId('book-header')).toContainText('DIRECT book');
  await expect(page.getByText('Book scope: DIRECT')).toBeVisible();
  await expect(page.getByText('CES-000000001')).toBeVisible();
  await expect(page.getByRole('cell', { name: '750,000.00 USD' })).toBeVisible();
});
