import type { Page } from '@playwright/test';

/**
 * Page Object (the chip-verification "Driver") for the login page. Encapsulates
 * the business action ("log in") from the raw selectors — if the login UI
 * changes, only this file changes, not the specs.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/login');
    await this.page.getByPlaceholder('用户名').fill(username);
    await this.page.getByPlaceholder('密码').fill(password);
    // AntD Button auto-inserts a space between two CJK chars → "登录" renders as "登 录".
    // Use a regex tolerant of whitespace instead of an exact name match.
    await this.page.getByRole('button', { name: /登\s*录/ }).click();
    // Wait until we leave /login (auth succeeded + menus fetched).
    await this.page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  }
}
