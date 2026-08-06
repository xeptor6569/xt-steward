/**
 * Milestone-one acceptance flow, end to end through the browser: first-boot
 * setup, login, node enrollment via the real steward-node CLI, workspace
 * discovery, a live-streamed diagnostic run, cancellation, and logout.
 */
import { expect, test, type Page } from "@playwright/test";
import { startNodeDaemon, type NodeDaemonHandle } from "./support/node-daemon";
import { ADMIN } from "./support/stack";

const NODE_NAME = `e2e-node-${Date.now().toString(36)}`;

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

let daemon: NodeDaemonHandle | undefined;

test.afterAll(async () => {
  await daemon?.stop();
});

test.describe.configure({ mode: "serial" });

test("first boot: setup wizard creates the administrator and signs them in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByText("Welcome to Steward XT")).toBeVisible();

  await page.getByLabel("Display name").fill(ADMIN.displayName);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(ADMIN.email)).toBeVisible();
});

test("vertical slice: enroll a node, run a diagnostic, watch it live, cancel another", async ({
  page,
}) => {
  await test.step("log in as the administrator", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  let token = "";
  await test.step("create a one-time enrollment token", async () => {
    await mainNav(page).getByRole("link", { name: "Nodes" }).click();
    await expect(page).toHaveURL(/\/nodes/);
    await page.getByRole("button", { name: "Create enrollment token" }).click();
    await page.getByLabel("Token name").fill("e2e token");
    await page.getByRole("button", { name: "Create token" }).click();

    const plaintext = page.getByTestId("enrollment-token-plaintext");
    await expect(plaintext).toBeVisible();
    token = (await plaintext.innerText()).trim();
    expect(token).toMatch(/^stx_enroll_/);
    await page.getByRole("button", { name: "Done" }).click();
  });

  await test.step("enroll and start the node daemon via the real CLI", async () => {
    daemon = await startNodeDaemon({ token, nodeName: NODE_NAME });
  });

  await test.step("the node comes online in the dashboard", async () => {
    const row = page.getByRole("row").filter({ hasText: NODE_NAME });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row.locator('[data-status="online"]')).toBeVisible({ timeout: 60_000 });
  });

  await test.step("the node's workspace is discovered", async () => {
    await mainNav(page).getByRole("link", { name: "Workspaces" }).click();
    await expect(page).toHaveURL(/\/workspaces/);
    const row = page.getByRole("row").filter({ hasText: "E2E Fixture Workspace" });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(NODE_NAME);
  });

  await test.step("submit a diagnostic run and watch its logs stream live", async () => {
    await page.getByRole("button", { name: "New diagnostic run" }).click();
    await page.getByRole("combobox", { name: "Workspace" }).click();
    await page.getByRole("option", { name: /E2E Fixture Workspace/ }).click();
    // A short simulated delay keeps the run alive long enough to observe the
    // live stream before it finishes.
    await page.getByLabel("Task (optional)").fill("delay=4");
    await page.getByRole("button", { name: "Start run" }).click();

    await expect(page).toHaveURL(/\/runs\/run_/, { timeout: 30_000 });

    const log = page.getByTestId("log-viewer");
    await expect(log).toContainText(`node.name: ${NODE_NAME}`, { timeout: 60_000 });
    await expect(log).toContainText("workspace.gitRepository: true");
    await expect(log).toContainText("Simulating a long diagnostic");

    // The run is still executing while we watch — then completes.
    await expect(page.locator('[data-status="succeeded"]')).toBeVisible({ timeout: 60_000 });
    await expect(log).toContainText("Diagnostic run finished");
    await expect(page.getByText("Exit code").locator("xpath=following-sibling::dd[1]")).toHaveText(
      "0",
    );
  });

  await test.step("cancel a long-running diagnostic from the UI", async () => {
    await mainNav(page).getByRole("link", { name: "Runs" }).click();
    await expect(page).toHaveURL(/\/runs$/);

    await page.getByRole("button", { name: "New diagnostic run" }).click();
    await page.getByRole("combobox", { name: "Workspace" }).click();
    await page.getByRole("option", { name: /E2E Fixture Workspace/ }).click();
    await page.getByLabel("Task (optional)").fill("delay=120");
    await page.getByRole("button", { name: "Start run" }).click();

    await expect(page).toHaveURL(/\/runs\/run_/, { timeout: 30_000 });
    await expect(page.locator('[data-status="running"]')).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Cancel run" }).click();
    await expect(page.locator('[data-status="cancelled"]')).toBeVisible({ timeout: 60_000 });
  });

  await test.step("the runs list shows both terminal states", async () => {
    await mainNav(page).getByRole("link", { name: "Runs" }).click();
    await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-status="cancelled"]').first()).toBeVisible();
  });

  await test.step("log out", async () => {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });
});

test("login rejects bad credentials and accepts good ones", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();

  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});
