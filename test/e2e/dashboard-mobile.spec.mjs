import { expect, test } from "@playwright/test";
import {
  loadDashboardSnapshotFromFiles,
  toDashboardStateResponse,
} from "../../scripts/dashboard-state-snapshot.mjs";

const auditToken = "dashboard-audit-token";

async function mockDashboardApi(page, mutateSnapshot = null) {
  const snapshot = await loadDashboardSnapshotFromFiles({ source: "browser-test" });
  if (mutateSnapshot) mutateSnapshot(snapshot);
  let sessionActive = false;

  await page.route("**/api/dashboard/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const token = request.headers()["x-dashboard-token"] || "";

    if (request.method() === "POST" && url.pathname === "/api/dashboard/session") {
      if (token !== auditToken) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Invalid dashboard write token" }),
        });
        return;
      }
      sessionActive = true;
      await route.fulfill({
        contentType: "application/json",
        headers: {
          "set-cookie": "dashboard_session=browser-test; Path=/api/dashboard; HttpOnly; SameSite=Strict",
        },
        body: JSON.stringify({
          ok: true,
          write_auth: { ok: true, status: 200, error: null, viewer: "browser-test" },
        }),
      });
      return;
    }

    if (request.method() === "DELETE" && url.pathname === "/api/dashboard/session") {
      sessionActive = false;
      await route.fulfill({
        contentType: "application/json",
        headers: {
          "set-cookie": "dashboard_session=; Path=/api/dashboard; HttpOnly; SameSite=Strict; Max-Age=0",
        },
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/api/dashboard/health") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          mode: "browser-test",
          storage: "memory",
          writable: true,
          write_auth: sessionActive
            ? { ok: true, status: 200, error: null, viewer: "browser-test" }
            : token
            ? (token === auditToken
              ? { ok: true, viewer: "browser-test" }
              : { ok: false, error: "Invalid dashboard write token" })
            : null,
        }),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/api/dashboard/state") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(toDashboardStateResponse(snapshot, {
          source: "browser-test",
          writable: true,
        })),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Browser-test endpoint not implemented" }),
    });
  });

  return { snapshot };
}

async function unlockDashboard(page) {
  await page.goto("/dashboard/");
  await page.getByRole("textbox", { name: "Dashboard Token" }).fill(auditToken);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  await expect(page.getByRole("heading", { name: "Embodied AI Project Dashboard" })).toBeVisible();
}

test("expanded project content stays inside its card on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboardApi(page);
  await unlockDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const project = page.locator('details.project-detail[data-project-id="umi-world-model"]');
  const body = project.locator(":scope > .project-body");
  await expect(project).toBeVisible();
  await expect(body).toBeVisible();

  const dimensions = await body.evaluate((element) => {
    const projectElement = element.closest("[data-project-id]");
    return {
      bodyWidth: element.getBoundingClientRect().width,
      projectRight: projectElement?.getBoundingClientRect().right || 0,
      projectWidth: projectElement?.getBoundingClientRect().width || 0,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.projectWidth + 1);
  expect(dimensions.projectWidth).toBeLessThanOrEqual(dimensions.viewportWidth - 20);
  expect(dimensions.projectRight).toBeLessThanOrEqual(dimensions.viewportWidth + 1);

  const summaryDimensions = await project.locator(":scope > summary > span").evaluate((element) => ({
    summaryWidth: element.getBoundingClientRect().width,
    projectWidth: element.closest("[data-project-id]")?.getBoundingClientRect().width || 0,
  }));
  expect(summaryDimensions.summaryWidth).toBeGreaterThanOrEqual(summaryDimensions.projectWidth * 0.65);
});

test("procurement stays readable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const engineeringBucket = page.locator('details.status-column[data-bucket="engineering"]');
  if (!await engineeringBucket.evaluate((element) => element.open)) {
    await engineeringBucket.locator(":scope > summary").click();
  }
  const project = page.locator('details.project-detail[data-project-id="general"]');
  if (!await project.evaluate((element) => element.open)) {
    await project.locator(":scope > summary").click();
  }
  const table = project.locator('table[data-kind="procurement_table"]');
  await expect(table).toBeVisible();

  for (const column of ["route", "updated_at", "notes"]) {
    const header = table.locator(`th[data-column="${column}"]`);
    await expect(header).toHaveCount(1);
    await expect(header).toBeHidden();
  }

  const itemCells = table.locator('tbody tr:not([hidden]) td[data-column="item"]');
  expect(await itemCells.count()).toBeGreaterThan(0);
  const itemWidth = await itemCells.first().evaluate((element) => element.getBoundingClientRect().width);
  expect(itemWidth).toBeGreaterThanOrEqual(130);

  const editButtons = table.locator(".procurement-edit-button");
  expect(await editButtons.count()).toBeGreaterThan(0);
  const editMetrics = await editButtons.first().evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(editMetrics.scrollWidth).toBeLessThanOrEqual(editMetrics.clientWidth);
  expect(editMetrics.scrollHeight).toBeLessThanOrEqual(editMetrics.clientHeight);

  const statusHeader = table.locator('th[data-column="status"]');
  const statusHeaderMetrics = await statusHeader.evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    overflowWrap: getComputedStyle(element).overflowWrap,
    shortLabel: getComputedStyle(element, "::before").content,
  }));
  expect(statusHeaderMetrics.fontSize).toBe("0px");
  expect(statusHeaderMetrics.overflowWrap).toBe("normal");
  expect(statusHeaderMetrics.shortLabel).toBe('"State"');

  const receivedRows = table.locator("tbody tr.project-intro-table-archive-row");
  await expect(receivedRows).toHaveCount(5);
  await expect(receivedRows.first()).toBeHidden();
  const receivedToggle = project.getByRole("button", { name: "Show received archive (5)" });
  await expect(receivedToggle).toBeVisible();
  await receivedToggle.click();
  await expect(receivedRows.first()).toBeVisible();
  await expect(project.getByRole("button", { name: "Hide received archive (5)" })).toBeVisible();
});

test("unlock never persists the bearer token in browser storage", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));

  expect(JSON.stringify(storage)).not.toContain(auditToken);
});

test("server session survives reload without leaking the bearer token", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__dashboardCopiedText = text;
        },
      },
    });
  });
  await mockDashboardApi(page);
  await unlockDashboard(page);

  await page.reload();
  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  await expect(page.getByRole("heading", { name: "Embodied AI Project Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Copy Agent Prompt" }).click();
  const prompt = await page.evaluate(() => window.__dashboardCopiedText || "");
  expect(prompt).toContain("$DASHBOARD_WRITE_TOKEN");
  expect(prompt).not.toContain(auditToken);
});

test("unsafe procurement URLs render as text instead of executable links", async ({ page }) => {
  const unsafeRowId = "unsafe-procurement-url-test";
  await mockDashboardApi(page, (snapshot) => {
    const project = snapshot.projects.find((candidate) => candidate.project_id === "general");
    project.intro_table.rows[0].row_id = unsafeRowId;
    project.intro_table.rows[0].url = "javascript:window.__unsafeProcurementLinkExecuted=true";
  });
  await unlockDashboard(page);

  const engineeringBucket = page.locator('details.status-column[data-bucket="engineering"]');
  if (!await engineeringBucket.evaluate((element) => element.open)) {
    await engineeringBucket.locator(":scope > summary").click();
  }
  const project = page.locator('details.project-detail[data-project-id="general"]');
  if (!await project.evaluate((element) => element.open)) {
    await project.locator(":scope > summary").click();
  }

  const unsafeItem = project.locator(
    `table[data-kind="procurement_table"] tbody tr[data-row-id="${unsafeRowId}"]:not(.procurement-edit-row) td[data-column="item"]`,
  );
  await expect(unsafeItem).toBeVisible();
  await expect(unsafeItem.locator("a")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.__unsafeProcurementLinkExecuted))).toBe(false);
});

test("explicit JSON fallback opens read-only without an API session", async ({ page }) => {
  await page.goto("/dashboard/?json=1");

  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  await expect(page.locator("body")).toHaveAttribute("data-data-source", "json");
  await expect(page.getByRole("heading", { name: "Embodied AI Project Dashboard" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Dashboard Token" })).toBeHidden();
  await expect(page.locator("[data-sync-status]")).toContainText("JSON fallback");
});

test("failed local comments survive a hosted reload until reconciled", async ({ page }) => {
  const taskId = "task_real_robot_infra_franka_wuji_ik_curobo_stability";
  const pendingBody = "Pending local comment must survive reload";
  const { snapshot } = await mockDashboardApi(page);
  await unlockDashboard(page);

  await page.evaluate(({ taskId, pendingBody }) => {
    localStorage.setItem("dashboard.task-interactions.v1", JSON.stringify({
      statuses: {},
      procurementRows: {},
      comments: {
        [taskId]: [{
          id: "comment_pending_browser_test",
          task_id: taskId,
          author: "You",
          body: pendingBody,
          created_at: "2026-07-10T00:00:00.000Z",
        }],
      },
    }));
  }, { taskId, pendingBody });

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-data-source", "vercel");
  const stored = await page.evaluate((taskId) => {
    const state = JSON.parse(localStorage.getItem("dashboard.task-interactions.v1") || "{}");
    return state.comments?.[taskId] || [];
  }, taskId);
  expect(stored).toHaveLength(1);
  await expect(page.getByText(pendingBody, { exact: true })).toHaveCount(1);
  await expect(page.locator("[data-sync-status]")).toContainText("pending local");

  snapshot.taskDoc.tasks.find((task) => task.task_id === taskId).comments.push({
    comment_id: "comment_remote_browser_test",
    task_id: taskId,
    author: "browser-test",
    body: pendingBody,
    created_at: "2026-07-10T00:00:01.000Z",
  });
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-data-source", "vercel");
  const reconciled = await page.evaluate((taskId) => {
    const state = JSON.parse(localStorage.getItem("dashboard.task-interactions.v1") || "{}");
    return state.comments?.[taskId] || [];
  }, taskId);
  expect(reconciled).toHaveLength(0);
  await expect(page.locator("[data-sync-status]")).not.toContainText("pending local");
});

test("collapsed project intros use a separate accessible toggle", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const project = page.locator('details.project-detail[data-project-id="umi-world-model"]');
  const intro = project.locator(".project-intro");
  const toggle = project.locator(".project-intro-toggle");
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(intro).not.toHaveAttribute("role", "button");
  expect(await intro.evaluate((element) => element.inert)).toBe(true);

  await intro.evaluate((element) => {
    const link = document.createElement("a");
    link.href = "https://example.com/intro-reference";
    link.textContent = "Injected intro reference";
    element.append(link);
  });
  const firstLink = intro.locator("a", { hasText: "Injected intro reference" });
  await firstLink.focus();
  expect(await intro.evaluate((element) => element.contains(document.activeElement))).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await intro.evaluate((element) => element.inert)).toBe(false);
  await firstLink.focus();
  expect(await intro.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test("status menus and procurement editors restore keyboard focus", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const statusButton = page.locator(".task-status-button").first();
  await statusButton.focus();
  await statusButton.press("Enter");
  const statusMenu = page.locator(`#${await statusButton.getAttribute("aria-controls")}`);
  await expect(statusMenu).toBeVisible();
  await expect(statusMenu.locator(".task-status-option").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(statusMenu).toBeHidden();
  await expect(statusButton).toBeFocused();

  const engineeringBucket = page.locator('details.status-column[data-bucket="engineering"]');
  if (!await engineeringBucket.evaluate((element) => element.open)) {
    await engineeringBucket.locator(":scope > summary").click();
  }
  const procurement = page.locator('details.project-detail[data-project-id="general"]');
  if (!await procurement.evaluate((element) => element.open)) {
    await procurement.locator(":scope > summary").click();
  }
  const editButton = procurement.locator(".procurement-edit-button").first();
  await editButton.click();
  const editRow = procurement.locator(`.procurement-edit-row[data-row-id="${await editButton.getAttribute("data-row-id")}"]`);
  await expect(editRow).toBeVisible();
  await expect(editRow.locator("input, textarea").first()).toBeFocused();
  await editRow.locator(".procurement-edit-cancel").click();
  await expect(editRow).toBeHidden();
  await expect(editButton).toBeFocused();
});

test("access gate and lightbox isolate background focus", async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto("/dashboard/");

  expect(await page.locator("main").evaluate((element) => element.inert)).toBe(true);
  await expect(page.getByRole("textbox", { name: "Dashboard Token" })).toBeFocused();
  await page.getByRole("textbox", { name: "Dashboard Token" }).fill(auditToken);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  expect(await page.locator("main").evaluate((element) => element.inert)).toBe(false);

  const image = page.locator(".zoomable-image:visible").first();
  await expect(image).toBeVisible();
  await image.focus();
  await expect(image).toBeFocused();
  await image.press("Enter");
  const lightbox = page.locator("[data-lightbox]");
  await expect(lightbox).toBeVisible();
  expect(await page.locator("main").evaluate((element) => element.inert)).toBe(true);
  const close = lightbox.getByRole("button", { name: "Close expanded figure" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  expect(await page.locator("main").evaluate((element) => element.inert)).toBe(false);
  await expect(image).toBeFocused();
});
