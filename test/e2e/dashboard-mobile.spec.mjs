import { expect, test } from "@playwright/test";
import {
  loadDashboardSnapshotFromFiles,
  toDashboardStateResponse,
} from "../../scripts/dashboard-state-snapshot.mjs";
import {
  allowedDashboardProjectIds,
  filterDashboardSnapshotForAuth,
} from "../../scripts/dashboard-access-control.mjs";

const auditToken = "dashboard-audit-token";

async function mockDashboardApi(page, mutateSnapshot = null, options = {}) {
  const snapshot = await loadDashboardSnapshotFromFiles({ source: "browser-test" });
  if (mutateSnapshot) mutateSnapshot(snapshot);
  let sessionActive = false;
  const role = options.role === "viewer" ? "viewer" : "admin";
  const auth = {
    ok: true,
    status: 200,
    error: null,
    viewer: role === "admin" ? "jingxiang" : "browser-viewer",
    user_id: role === "admin" ? null : "user_browser_viewer",
    role,
    visibility: role === "admin"
      ? { bucket_ids: ["research", "engineering", "survey", "archive"], include_project_ids: [], exclude_project_ids: [] }
      : (options.visibility || { bucket_ids: ["research"], include_project_ids: [], exclude_project_ids: [] }),
    permissions: {
      can_write: true,
      can_manage_access: role === "admin",
    },
  };
  const managedToken = "dash_browser_test_token_shown_once_1234567890";
  const accessUsers = [{
    user_id: "env_admin_browser",
    viewer: "jingxiang",
    role: "admin",
    enabled: true,
    visibility: { bucket_ids: ["research", "engineering", "survey", "archive"], include_project_ids: [], exclude_project_ids: [] },
    token_fingerprint: "sha256:adminbrowser1234",
    token_hint: "Environment credential",
    created_at: null,
    updated_at: null,
    rotated_at: null,
    managed_by: "environment",
    editable: false,
    token_copy_mode: "none",
  }, {
    user_id: "env_ziyang_browser",
    viewer: "Ziyang",
    role: "viewer",
    enabled: true,
    visibility: { bucket_ids: ["research"], include_project_ids: [], exclude_project_ids: [] },
    token_fingerprint: "sha256:ziyangbrowser12",
    token_hint: "Environment credential",
    created_at: null,
    updated_at: null,
    rotated_at: null,
    managed_by: "environment",
    editable: true,
    token_copy_mode: "environment-hidden",
  }];

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
          write_auth: auth,
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
            ? auth
            : token
            ? (token === auditToken
              ? auth
              : { ok: false, error: "Invalid dashboard write token" })
            : null,
        }),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/api/dashboard/state") {
      if (!sessionActive) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Dashboard authentication required" }),
        });
        return;
      }
      const visibleSnapshot = filterDashboardSnapshotForAuth(snapshot, auth);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(toDashboardStateResponse(visibleSnapshot, {
          source: "browser-test",
          writable: auth.permissions.can_write,
          auth,
        })),
      });
      return;
    }

    if (request.method() === "POST" && new Set([
      "/api/dashboard/task-create",
      "/api/dashboard/task-status",
      "/api/dashboard/task-update",
      "/api/dashboard/task-comment",
      "/api/dashboard/task-comment-delete",
      "/api/dashboard/project-table-row-update",
    ]).has(url.pathname)) {
      if (!sessionActive) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Dashboard authentication required" }),
        });
        return;
      }
      const body = request.postDataJSON();
      const task = body.task_id
        ? snapshot.taskDoc.tasks.find((candidate) => candidate.task_id === body.task_id)
        : null;
      const projectId = body.project_id || task?.project_id || "";
      const allowedIds = allowedDashboardProjectIds(snapshot, auth);
      if (role !== "admin" && !allowedIds.has(projectId)) {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Dashboard write is outside the viewer's visible scope" }),
        });
        return;
      }
      if (url.pathname === "/api/dashboard/task-status" && task) task.status = body.status;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task_id: body.task_id || null,
          project_id: projectId,
          status: body.status || null,
          task,
          meta: { storage: "browser-test" },
        }),
      });
      return;
    }

    if (url.pathname === "/api/dashboard/access-users") {
      if (!sessionActive || role !== "admin") {
        await route.fulfill({
          status: sessionActive ? 403 : 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Dashboard access settings require the administrator role" }),
        });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            users: accessUsers,
            projects: snapshot.portfolio.projects.map(({ project_id, title, bucket }) => ({ project_id, title, bucket })),
          }),
        });
        return;
      }
      const body = request.postDataJSON();
      if (request.method() === "POST" && body.action !== "rotate") {
        const user = {
          user_id: "user_browser_created",
          viewer: body.viewer,
          role: "viewer",
          enabled: true,
          visibility: body.visibility,
          token_fingerprint: "sha256:viewerbrowser12",
          token_hint: "dash_browse...",
          created_at: "2026-07-18T08:00:00.000Z",
          updated_at: "2026-07-18T08:00:00.000Z",
          rotated_at: "2026-07-18T08:00:00.000Z",
          managed_by: "dashboard",
          editable: true,
        };
        accessUsers.push(user);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, user, token: managedToken }),
        });
        return;
      }
      const user = accessUsers.find((candidate) => candidate.user_id === body.user_id);
      if (request.method() === "PATCH" && user) Object.assign(user, body);
      if (request.method() === "DELETE" && user) user.enabled = false;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user,
          ...(request.method() === "POST" ? { token: managedToken } : {}),
        }),
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
  await expect(receivedRows).toHaveCount(6);
  await expect(receivedRows.first()).toBeHidden();
  const receivedToggle = project.getByRole("button", { name: "Show received archive (6)" });
  await expect(receivedToggle).toBeVisible();
  await receivedToggle.click();
  await expect(receivedRows.first()).toBeVisible();
  await expect(project.getByRole("button", { name: "Hide received archive (6)" })).toBeVisible();
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

test("admin settings creates a one-time viewer token without persisting it", async ({ page }) => {
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

  const settings = page.getByRole("button", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  await expect(dialog).toBeVisible();
  const createForm = dialog.locator("[data-access-user-create]");
  await createForm.getByRole("textbox", { name: "Name" }).fill("Davide");
  await createForm.getByRole("button", { name: "Create token" }).click();
  const tokenField = dialog.getByRole("textbox", { name: "New dashboard access token" });
  await expect(tokenField).toHaveValue("dash_browser_test_token_shown_once_1234567890");
  await dialog.getByRole("button", { name: "Copy token", exact: true }).click();
  expect(await page.evaluate(() => window.__dashboardCopiedText || "")).toBe("dash_browser_test_token_shown_once_1234567890");
  await expect(dialog.getByRole("button", { name: "Davide" })).toBeVisible();
  page.once("dialog", async (confirmation) => { await confirmation.accept(); });
  await dialog.getByRole("button", { name: "Regenerate & copy token" }).click();
  await expect(tokenField).toHaveValue("dash_browser_test_token_shown_once_1234567890");
  expect(await page.evaluate(() => window.__dashboardCopiedText || "")).toBe("dash_browser_test_token_shown_once_1234567890");

  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain("dash_browser_test_token_shown_once_1234567890");
  await dialog.getByRole("button", { name: "Close dashboard access settings" }).click();
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
});

test("admin settings can rescope environment viewer tokens without exposing secrets", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Ziyang/ }).click();
  const editForm = dialog.locator("[data-access-user-edit]");
  await expect(editForm.getByText("The current environment token value is encrypted outside the dashboard and cannot be copied from Settings.")).toBeVisible();
  await expect(editForm.getByRole("textbox", { name: "Name" })).toBeDisabled();
  await expect(editForm.getByRole("button", { name: "Regenerate & copy token" })).toHaveCount(0);

  await editForm.evaluate((form) => {
    const research = form.querySelector('input[name="bucket_research"]');
    const general = form.querySelector('input[data-access-project-id="general"]');
    research.checked = false;
    general.checked = true;
    research.dispatchEvent(new Event("change", { bubbles: true }));
    general.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const saveResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/dashboard/access-users")
    && response.request().method() === "PATCH"
  ));
  await editForm.evaluate((form) => { form.requestSubmit(); });
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok()).toBe(true);

  const updatedAccess = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard/access-users");
    const data = await response.json();
    return data.users.find((user) => user.viewer === "Ziyang");
  });
  expect(updatedAccess.visibility).toEqual({
    bucket_ids: [],
    include_project_ids: ["general"],
    exclude_project_ids: [],
  });
  expect(JSON.stringify(updatedAccess)).not.toContain("dashboard-audit-token");
});

test("viewer can write visible cards but cannot open settings or write hidden cards", async ({ page }) => {
  const { snapshot } = await mockDashboardApi(page, null, {
    role: "viewer",
    visibility: {
      bucket_ids: ["research"],
      include_project_ids: ["general"],
      exclude_project_ids: ["umi-world-model"],
    },
  });
  await unlockDashboard(page);

  const expectedIds = snapshot.portfolio.projects
    .filter((project) => (project.bucket === "research" || project.project_id === "general") && project.project_id !== "umi-world-model")
    .map((project) => project.project_id);
  const renderedIds = await page.locator("[data-project-id]").evaluateAll((elements) => (
    [...new Set(elements.map((element) => element.dataset.projectId))]
  ));
  expect(renderedIds.sort()).toEqual(expectedIds.sort());
  await expect(page.getByRole("button", { name: "Settings" })).toBeHidden();
  await expect(page.locator('[data-details-key="section:weekly-context"]')).toBeHidden();
  expect(await page.locator(".task-create-detail").count()).toBeGreaterThan(0);
  expect(await page.locator(".comment-form").count()).toBeGreaterThan(0);
  expect(await page.locator(".procurement-edit-button").count()).toBeGreaterThan(0);
  await expect(page.locator(".task-status-button").first()).toBeEnabled();
  const visibleTask = snapshot.taskDoc.tasks.find((task) => expectedIds.includes(task.project_id));
  const hiddenTask = snapshot.taskDoc.tasks.find((task) => !expectedIds.includes(task.project_id));
  expect(visibleTask).toBeTruthy();
  expect(hiddenTask).toBeTruthy();
  const writeStatuses = await page.evaluate(async ({ visibleTaskId, hiddenTaskId }) => {
    const request = (taskId) => fetch("/api/dashboard/task-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: taskId, status: "active" }),
    });
    return [
      (await request(visibleTaskId)).status,
      (await request(hiddenTaskId)).status,
    ];
  }, { visibleTaskId: visibleTask.task_id, hiddenTaskId: hiddenTask.task_id });
  expect(writeStatuses).toEqual([200, 403]);
  const forbiddenStatuses = await page.evaluate(async () => {
    const request = (method, body = null) => fetch("/api/dashboard/access-users", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then((response) => response.status);
    return [
      await request("GET"),
      await request("POST", { viewer: "Nope" }),
      await request("PATCH", { user_id: "env_ziyang_browser", visibility: { bucket_ids: ["archive"], include_project_ids: [], exclude_project_ids: [] } }),
      await request("DELETE", { user_id: "env_ziyang_browser" }),
    ];
  });
  expect(forbiddenStatuses).toEqual([403, 403, 403, 403]);
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

test("URDF baseline names in the UMI Robot Layer branch are clickable", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const project = page.locator(
    'details.project-detail[data-project-id="umi-world-model"]',
  );
  const expectedLinks = [
    ["BridgeV2W", "https://arxiv.org/abs/2602.03793"],
    ["Kinema4D", "https://arxiv.org/abs/2603.16669"],
    ["OSCAR", "https://arxiv.org/abs/2606.04463"],
    ["SimDist", "https://sim-dist.github.io/"],
  ];

  for (const [label, href] of expectedLinks) {
    const link = project.locator("a", { hasText: label });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
  }
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
