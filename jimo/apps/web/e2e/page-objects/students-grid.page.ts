import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the generated students grid (pageType=grid). Keeps the
 * brittle EditableProTable selectors in one place so the spec reads as a
 * business flow, not a DOM hunt.
 */
export class StudentsGridPage {
  readonly path = '/lc/students';
  constructor(private readonly page: Page) {}

  addRowButton(): Locator {
    // Regex tolerates AntD's auto-inserted CJK spacing, if any.
    return this.page.getByRole('button', { name: /新增行/ });
  }

  rows(): Locator {
    return this.page.locator('.ant-table-tbody tr');
  }

  /** Navigate to the grid and wait for it to mount (the 新增行 button appears). */
  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.addRowButton().waitFor({ state: 'visible', timeout: 20_000 });
  }

  async addRow(): Promise<void> {
    await this.addRowButton().click();
  }

  async rowCount(): Promise<number> {
    return this.rows().count();
  }

  /**
   * Fill the required + uniqueness-critical fields of the newest (last) row:
   *   student_no (nth0), name (nth1), id_card (nth4).
   *
   * id_card MUST be filled and unique per run: lc_students has a partial unique
   * index `idx_students_id_card_active` over non-deleted rows, and the column
   * defaults to ''. Leaving it empty collides with any prior empty-id_card row
   * and the create POST returns 500 — that 500 is the real bug-5 root cause
   * (the POST always fired; it failed, so the row never persisted).
   *
   * Column→input order verified against the live grid via Playwright MCP:
   *   0=学号 1=姓名 2=性别(select) 3=出生日期(date) 4=身份证号 5=手机号 ...
   */
  async fillLastRowRequired(studentNo: string, name: string, idCard: string): Promise<void> {
    const inputs = this.rows().last().locator('input');
    await inputs.nth(0).fill(studentNo);
    await inputs.nth(1).fill(name);
    await inputs.nth(4).fill(idCard);
  }

  async tableText(): Promise<string> {
    return (await this.page.locator('.ant-table').first().textContent()) ?? '';
  }
}
