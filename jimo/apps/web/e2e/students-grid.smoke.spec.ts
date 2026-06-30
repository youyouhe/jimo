import { test, expect } from '@playwright/test';
import { LoginPage } from './page-objects/login.page';
import { StudentsGridPage } from './page-objects/students-grid.page';

/**
 * L3 E2E smoke (P0 only). Covers the highest-value main flows against the live
 * dev stack: auth, route+RBAC access, grid mount, and the new-row-persists
 * regression (bug-5: a new row used to vanish on refresh because no POST fired).
 *
 * NOTE: these run against the running dev stack + dev DB, so a created student
 * persists in lowcode_db (marked E2E_* for easy cleanup). Keep this suite tiny.
 */
test.describe('L3 smoke: students grid', () => {
  test('login → open grid → page renders (auth + route + RBAC + mount)', async ({ page }) => {
    await new LoginPage(page).login('admin', 'admin123');
    const grid = new StudentsGridPage(page);
    await grid.open();
    await expect(grid.addRowButton()).toBeVisible();
    expect(await grid.rowCount()).toBeGreaterThanOrEqual(0);
  });

  test('new row auto-creates and persists (bug-5 regression)', async ({ page, request }) => {
    await new LoginPage(page).login('admin', 'admin123');
    const grid = new StudentsGridPage(page);
    await grid.open();

    await grid.addRow();
    const stamp = Date.now();
    const studentNo = `E2E_${stamp}`;
    // id_card has a partial unique index (idx_students_id_card_active) over
    // non-deleted rows and defaults to '', so it must be unique per run — otherwise
    // the create POST collides with a prior empty-id_card row and returns 500.
    // (Real bug-5 root cause, confirmed via Playwright MCP: the POST always fired;
    // it failed with 500, so the row never persisted and vanished on refresh.)
    const idCard = `E2E${stamp}`;

    // Wait for the create POST directly (deterministic — no arbitrary sleep).
    const post = page.waitForResponse(
      (r) => r.url().includes('/api/v1/lc/students') && r.request().method() === 'POST',
      { timeout: 8000 },
    );
    await grid.fillLastRowRequired(studentNo, 'E2E Tester', idCard);
    const res = await post;
    expect(res.ok()).toBeTruthy();

    // Authoritative persistence check (DOM-independent): the row is in the DB.
    // EditableProTable renders cells as <input>s, so reading the DOM is fragile;
    // the API list is the real oracle that the row persisted.
    const login = await request.post('http://localhost:8888/api/v1/auth/login', {
      data: { username: 'admin', password: 'admin123' },
    });
    const token = (await login.json()).data.access_token;
    const list = await request.get('http://localhost:8888/api/v1/lc/students', {
      params: { page: 1, pageSize: 100 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const nos = (await list.json()).data.list.map((s: any) => s.student_no);
    expect(nos).toContain(studentNo);
  });
});
