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
    enabled: options.environmentEnabled !== false,
    visibility: { bucket_ids: ["research"], include_project_ids: [], exclude_project_ids: [] },
    token_fingerprint: "sha256:ziyangbrowser12",
    token_hint: "Environment credential",
    created_at: null,
    updated_at: null,
    rotated_at: null,
    managed_by: "environment",
    editable: true,
    token_copy_mode: "environment-copyable",
  }];
  if (options.includeManagedDuplicate) {
    accessUsers.push({
      user_id: "user_ziyang_duplicate",
      viewer: "Ziyang",
      role: "viewer",
      enabled: true,
      visibility: { bucket_ids: ["research"], include_project_ids: [], exclude_project_ids: [] },
      token_fingerprint: "sha256:duplicate123456",
      token_hint: "dash_duplic...",
      created_at: "2026-07-18T08:00:00.000Z",
      updated_at: "2026-07-18T08:00:00.000Z",
      rotated_at: "2026-07-18T08:00:00.000Z",
      managed_by: "dashboard",
      editable: true,
    });
  }
  const environmentToken = "environment_browser_test_token_1234567890";
  const passkeyState = {
    passkeys: Array.isArray(options.initialPasskeys) ? [...options.initialPasskeys] : [],
    requests: [],
  };
  const passkeyRegistrationOptions = {
    challenge: "cmVnaXN0cmF0aW9uLWNoYWxsZW5nZQ",
    rp: { id: "127.0.0.1", name: "Dashboard browser test" },
    user: {
      id: "YnJvd3Nlci10ZXN0LWFkbWlu",
      name: "jingxiang",
      displayName: "Jingxiang Guo",
    },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 300000,
    attestation: "none",
    excludeCredentials: [],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  };
  const passkeyAuthenticationOptions = {
    challenge: "YXV0aGVudGljYXRpb24tY2hhbGxlbmdl",
    rpId: "127.0.0.1",
    timeout: 300000,
    userVerification: "required",
    allowCredentials: [{
      id: "YnJvd3Nlci1wYXNza2V5LWNyZWRlbnRpYWw",
      type: "public-key",
      transports: ["internal"],
    }],
  };

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

    if (url.pathname === "/api/dashboard/passkeys" && url.searchParams.get("action") === "options") {
      if (request.method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            available: Boolean(options.passkeyAvailable || passkeyState.passkeys.length),
          }),
        });
        return;
      }
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        if (body.ceremony === "registration" && (!sessionActive || role !== "admin")) {
          await route.fulfill({
            status: sessionActive ? 403 : 401,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "Administrator session required" }),
          });
          return;
        }
        const registration = body.ceremony === "registration";
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            ceremony_id: registration ? "cmVnaXN0cmF0aW9uLWlk" : "YXV0aGVudGljYXRpb24taWQ",
            options: registration ? passkeyRegistrationOptions : passkeyAuthenticationOptions,
          }),
        });
        return;
      }
    }

    if (
      request.method() === "POST"
      && url.pathname === "/api/dashboard/passkeys"
      && url.searchParams.get("action") === "verify"
    ) {
      const body = request.postDataJSON();
      passkeyState.requests.push(body);
      if (body.ceremony === "registration") {
        if (!sessionActive || role !== "admin") {
          await route.fulfill({
            status: sessionActive ? 403 : 401,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "Administrator session required" }),
          });
          return;
        }
        const passkey = {
          credential_id: body.response.id,
          counter: 0,
          transports: body.response.response.transports || ["internal"],
          device_type: "multiDevice",
          backed_up: true,
          label: body.label || "Passkey",
          created_at: "2026-07-21T04:00:00.000Z",
          last_used_at: null,
        };
        passkeyState.passkeys.push(passkey);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, passkey }),
        });
        return;
      }
      sessionActive = true;
      await route.fulfill({
        contentType: "application/json",
        headers: {
          "set-cookie": "dashboard_session=browser-passkey-test; Path=/api/dashboard; HttpOnly; SameSite=Strict",
        },
        body: JSON.stringify({ ok: true, write_auth: auth }),
      });
      return;
    }

    if (url.pathname === "/api/dashboard/passkeys" && !url.searchParams.has("action")) {
      if (!sessionActive || role !== "admin") {
        await route.fulfill({
          status: sessionActive ? 403 : 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "Administrator session required" }),
        });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            passkeys: passkeyState.passkeys,
            recovery: { token_login_available: true },
          }),
        });
        return;
      }
      const body = request.postDataJSON();
      const index = passkeyState.passkeys.findIndex((candidate) => candidate.credential_id === body.credential_id);
      const passkey = index >= 0 ? passkeyState.passkeys[index] : null;
      if (request.method() === "PATCH" && passkey) passkey.label = body.label;
      if (request.method() === "DELETE" && index >= 0) passkeyState.passkeys.splice(index, 1);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          passkey,
          ...(request.method() === "DELETE" ? { deleted: true } : {}),
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
      if (request.method() === "POST" && body.action === "copy") {
        const user = accessUsers.find((candidate) => candidate.user_id === body.user_id);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, user, token: environmentToken }),
        });
        return;
      }
      if (request.method() === "POST" && body.action === "delete") {
        const index = accessUsers.findIndex((candidate) => candidate.user_id === body.user_id);
        const [user] = index >= 0 ? accessUsers.splice(index, 1) : [null];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, user, deleted: true }),
        });
        return;
      }
      if (request.method() === "POST" && !body.action) {
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

  return { snapshot, passkeyState };
}

async function unlockDashboard(page) {
  await page.goto("/dashboard/");
  await page.getByRole("textbox", { name: "Dashboard Token" }).fill(auditToken);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  await expect(page.getByRole("heading", { name: "Embodied AI Project Dashboard" })).toBeVisible();
}

async function stubPasskeyCredentials(page) {
  await page.addInitScript(() => {
    const bytes = (value) => new TextEncoder().encode(value).buffer;
    const credentialId = "YnJvd3Nlci1wYXNza2V5LWNyZWRlbnRpYWw";
    if (!window.PublicKeyCredential) window.PublicKeyCredential = class PublicKeyCredential {};
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        create: async ({ publicKey }) => {
          window.__dashboardPasskeyCreateConverted = Boolean(
            publicKey.challenge instanceof ArrayBuffer
            && publicKey.user?.id instanceof ArrayBuffer,
          );
          return {
            id: credentialId,
            rawId: bytes("browser-passkey-credential"),
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
              attestationObject: bytes("registration-attestation-private-marker"),
              clientDataJSON: bytes("registration-client-data-private-marker"),
              getTransports: () => ["internal"],
              getPublicKeyAlgorithm: () => -7,
              getPublicKey: () => bytes("registration-public-key-marker"),
              getAuthenticatorData: () => bytes("registration-authenticator-data-marker"),
            },
            getClientExtensionResults: () => ({}),
          };
        },
        get: async ({ publicKey }) => {
          window.__dashboardPasskeyGetConverted = Boolean(
            publicKey.challenge instanceof ArrayBuffer
            && publicKey.allowCredentials?.[0]?.id instanceof ArrayBuffer,
          );
          return {
            id: credentialId,
            rawId: bytes("browser-passkey-credential"),
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
              authenticatorData: bytes("authentication-authenticator-private-marker"),
              clientDataJSON: bytes("authentication-client-data-private-marker"),
              signature: bytes("authentication-signature-private-marker"),
              userHandle: null,
            },
            getClientExtensionResults: () => ({}),
          };
        },
      },
    });
  });
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

test("projects without hero visuals use a full-width text column on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboardApi(page, (snapshot) => {
    const standardLayout = snapshot.projects.find(
      (project) => project.project_id === "dexora-rl100-dexhand",
    );
    const defaultLayout = snapshot.projects.find(
      (project) => project.project_id === "archive-agent-society-world-model",
    );
    if (standardLayout) {
      delete standardLayout.asset;
      standardLayout.visual = { layout: "standard" };
    }
    if (defaultLayout) {
      delete defaultLayout.asset;
      delete defaultLayout.visual;
    }
  });
  await unlockDashboard(page);

  for (const projectId of [
    "dexora-rl100-dexhand",
    "archive-agent-society-world-model",
  ]) {
    const project = page.locator(`details.project-detail[data-project-id="${projectId}"]`);
    await project.evaluate((element) => {
      let current = element;
      while (current) {
        if (current.tagName === "DETAILS") current.open = true;
        current = current.parentElement;
      }
    });
    const body = project.locator(":scope > .project-body");
    await expect(body).toHaveClass(/\bsingle-column\b/);
    await expect(body).not.toHaveClass(/\bcompact\b/);
    await expect(body.locator(":scope > figure, :scope > .project-visual-column")).toHaveCount(0);
    const layout = await body.evaluate((element) => ({
      columnCount: getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      bodyContentWidth: element.clientWidth
        - Number.parseFloat(getComputedStyle(element).paddingLeft)
        - Number.parseFloat(getComputedStyle(element).paddingRight),
      textWidth: element.querySelector(":scope > div")?.getBoundingClientRect().width || 0,
    }));
    expect(layout.columnCount).toBe(1);
    expect(Math.abs(layout.bodyContentWidth - layout.textWidth)).toBeLessThanOrEqual(1);
  }

  const visualProject = page.locator(
    'details.project-detail[data-project-id="umi-world-model"]',
  );
  const visualBody = visualProject.locator(":scope > .project-body");
  await expect(visualBody.locator(":scope > figure, :scope > .project-visual-column")).toHaveCount(1);
  await expect(visualBody).not.toHaveClass(/\bsingle-column\b/);
});

test("editorial evidence markers stay out of rendered dashboard copy", async ({ page }) => {
  await mockDashboardApi(page, (snapshot) => {
    const project = snapshot.projects.find(
      (candidate) => candidate.project_id === "human-intention-sensorium-survey",
    );
    if (!project) return;
    project.description = "[KNOWN] [CONFIDENCE: HIGH] Visible project description.";
    project.summary = "[INFERRED][HIGH] Visible project summary.";
    project.details = [{
      text: "[COMPUTED] [CONFIDENCE: MEDIUM] Visible project detail.",
    }];
    project.risks_decisions = [
      "[GUARDRAIL][MED] Visible decision.",
      "[MEETING 2026-07-20] Provenance label remains.",
    ];
    project.references = [{
      title: "Evidence reference",
      url: "https://example.com/evidence",
      notes: "[KNOWN][HIGH] Visible reference notes.",
    }];

    const task = snapshot.taskDoc.tasks.find(
      (candidate) => candidate.project_id === project.project_id,
    );
    if (!task) return;
    task.description = "[INFERRED] [CONFIDENCE: HIGH] Visible task description.";
    task.comments = [{
      comment_id: "review-marker-comment",
      body: "[COMPUTED][HIGH] Visible task comment.",
      author: "Audit",
      created_at: "2026-07-30T00:00:00.000Z",
    }];
  });
  await unlockDashboard(page);

  const project = page.locator(
    'details.project-detail[data-project-id="human-intention-sensorium-survey"]',
  );
  await expect(project).toContainText("Visible project description.");
  await expect(project).toContainText("Visible project summary.");
  await expect(project).toContainText("Visible task description.");
  await expect(project).toContainText("Visible task comment.");
  await expect(project).toContainText("[MEETING 2026-07-20] Provenance label remains.");
  await expect(project).not.toContainText(
    /\[(?:KNOWN|INFERRED|COMPUTED|GUARDRAIL|CONFIDENCE:\s*(?:HIGH|MEDIUM|MED|LOW)|HIGH|MEDIUM|MED|LOW)\]/i,
  );
});

test("landscape Image Context references stay uncropped", async ({ page }) => {
  await mockDashboardApi(page, (snapshot) => {
    snapshot.portfolio.visual_references = [{
      src: "dashboard/assets/robot4robot-r4r-01-semantic-3d-pipeline-20260731.jpg",
      alt: "Robot4Robot semantic 3D scene pipeline",
      caption: "Robot4Robot semantic 3D scene pipeline.",
      source: "Robot4Robot",
      added_at: "2026-07-31",
      fit: "landscape-contain",
    }];
  });
  await unlockDashboard(page);

  const card = page.locator("[data-image-context-grid] .image-context-card").first();
  const media = card.locator(".image-context-media");
  const image = media.locator("img");
  await expect(card).toHaveClass(/\bfit-landscape-contain\b/);
  await expect(media).toHaveClass(/\bis-landscape-contain\b/);
  await expect(image).toHaveCSS("object-fit", "contain");
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await card.evaluate((element) => ({
    card: element.getBoundingClientRect().width,
    grid: element.parentElement?.getBoundingClientRect().width || 0,
  }));
  expect(widths.card / widths.grid).toBeGreaterThan(0.9);
});

test("Dual-Sim renders as a standalone Survey card with its three method figures", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const dualSim = page.locator(
    'details.project-detail[data-project-id="dual-sim-video-guidance-survey"]',
  );
  await expect(dualSim).toHaveAttribute("data-bucket", "survey");
  await expect(dualSim).toContainText("Dual-Sim / Sim-Video-Guided World Model");
  await expect(dualSim.locator(".project-body img")).toHaveAttribute(
    "src",
    /dualsim-wx-01\.png$/,
  );

  const selfImproving = page.locator(
    'details.project-detail[data-project-id="self-improving-agents"]',
  );
  await expect(selfImproving.locator(".project-body img")).toHaveAttribute(
    "src",
    /self-improving-embodied-harness-loop-20260707\.png$/,
  );

  const imageContext = page.locator("[data-image-context-grid]");
  await expect(imageContext.locator('img[src$="dualsim-wx-01.png"]')).toHaveCount(1);
  await expect(imageContext.locator('img[src$="dualsim-wx-02.png"]')).toHaveCount(1);
  await expect(imageContext.locator('img[src$="dualsim-wx-03.png"]')).toHaveCount(1);
});

test("wide project intro tables scroll inside the card on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboardApi(page, (snapshot) => {
    const project = snapshot.projects.find(
      (candidate) => candidate.project_id === "dexora-rl100-dexhand",
    );
    if (!project) return;
    project.asset = "dashboard/assets/robotics-3d-printing-platform.png";
    project.visual = { layout: "standard" };
    project.intro_table = {
      kind: "architecture_status_table",
      caption: "Wide mobile table",
      columns: [
        { key: "lane", label: "Lane" },
        { key: "design_variables", label: "Joint design variables" },
        { key: "representative_work", label: "Representative work" },
        { key: "gate", label: "Required gate" },
      ],
      rows: [{
        lane: "Product / object retrofit",
        design_variables: "Attachment, handle, fixture, material and affordance",
        representative_work: "Object Adaptation",
        gate: "Printability, tolerance and held-out validation",
      }],
    };
  });
  await unlockDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const project = page.locator(
    'details.project-detail[data-project-id="dexora-rl100-dexhand"]',
  );
  await project.evaluate((element) => {
    let current = element;
    while (current) {
      if (current.tagName === "DETAILS") current.open = true;
      current = current.parentElement;
    }
  });
  const dimensions = await project.evaluate((element) => {
    const body = element.querySelector(":scope > .project-body");
    const bodyColumn = body?.querySelector(":scope > div");
    const tableWrap = body?.querySelector(".project-intro-table-wrap");
    return {
      projectWidth: element.getBoundingClientRect().width,
      bodyWidth: body?.getBoundingClientRect().width || 0,
      bodyColumnWidth: bodyColumn?.getBoundingClientRect().width || 0,
      tableClientWidth: tableWrap?.clientWidth || 0,
      tableScrollWidth: tableWrap?.scrollWidth || 0,
      viewportWidth: document.documentElement.clientWidth,
      documentOverflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
    };
  });

  expect(dimensions.projectWidth).toBeLessThanOrEqual(dimensions.viewportWidth - 20);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.projectWidth + 1);
  expect(dimensions.bodyColumnWidth).toBeLessThanOrEqual(dimensions.bodyWidth + 1);
  expect(dimensions.tableClientWidth).toBeLessThanOrEqual(dimensions.bodyColumnWidth + 1);
  expect(dimensions.tableScrollWidth).toBeGreaterThan(dimensions.tableClientWidth);
  expect(dimensions.documentOverflow).toBeLessThanOrEqual(1);
});

test("UMI Stage 1 and Stage 3 cards open their published Atlas pages", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const project = page.locator('details.project-detail[data-project-id="umi-world-model"]');
  const stage1Link = project.locator(
    '.subproject-link[href="https://gammaworld-training-atlas.linslabnus.chatgpt.site/"]',
  );
  const stage3Link = project.locator(
    '.subproject-link[href="https://gammaworld-training-atlas.linslabnus.chatgpt.site/stage-3"]',
  );

  await expect(stage1Link).toHaveCount(1);
  await expect(stage1Link).toHaveText("Open Stage 1 webpage ↗");
  await expect(stage1Link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(stage3Link).toHaveCount(1);
  await expect(stage3Link).toHaveText("Open Stage 3 webpage ↗");
  await expect(stage3Link).toHaveAttribute("rel", "noopener noreferrer");
});

test("UMI presents equal dual hero visuals and stacks methods under the left figure", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const project = page.locator('details.project-detail[data-project-id="umi-world-model"]');
  if (!await project.evaluate((element) => element.open)) {
    await project.locator(":scope > summary").click();
  }

  const projectBody = project.locator(":scope > .project-body");
  const bodyColumn = projectBody.locator(":scope > div");
  const visualColumn = projectBody.locator(":scope > .project-visual-column");
  const utility = bodyColumn.locator(":scope > .layer-utility-card");
  const references = visualColumn.locator(":scope > .layer-reference-grid");
  const toggle = bodyColumn.locator(":scope > .project-intro-toggle");
  const architectureImage = visualColumn.locator(":scope > figure img");
  await expect(visualColumn.locator(":scope > figure")).toHaveCount(1);
  await expect(visualColumn.locator(":scope > figure + .layer-reference-grid")).toHaveCount(1);
  await expect(utility).toBeVisible();
  await expect(project.locator(".project-body figure .layer-utility-card")).toHaveCount(0);
  await expect(bodyColumn.locator(":scope > .layer-utility-card + .project-intro")).toHaveCount(1);
  await expect(utility.locator("h4")).toHaveText("Layered Data Utility");
  await expect(utility.locator(".layer-utility-diagram-svg")).toHaveCount(1);
  const [architectureBox, utilityBox, diagramBox] = await Promise.all([
    architectureImage.boundingBox(),
    utility.boundingBox(),
    utility.locator(".layer-utility-diagram-svg").boundingBox(),
  ]);
  expect(architectureBox).not.toBeNull();
  expect(utilityBox).not.toBeNull();
  expect(diagramBox).not.toBeNull();
  expect(Math.abs(architectureBox.y - utilityBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(architectureBox.height - utilityBox.height)).toBeLessThanOrEqual(2);
  expect(diagramBox.y).toBeGreaterThanOrEqual(utilityBox.y);
  expect(diagramBox.y + diagramBox.height).toBeLessThanOrEqual(utilityBox.y + utilityBox.height + 1);
  const heroStyles = await architectureImage.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      aspectRatio: styles.aspectRatio,
      objectFit: styles.objectFit,
    };
  });
  expect(heroStyles.aspectRatio).toBe("16 / 9");
  expect(heroStyles.objectFit).toBe("cover");
  await expect(references.locator(".layer-reference-card")).toHaveCount(3);
  await expect(references).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(references).toBeVisible();
  const referenceColumns = await references.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(referenceColumns).toBe(1);
  await expect(references).toContainText("Scene / Background");
  await expect(references).toContainText("Object(s) / Contact");
  await expect(references).toContainText("Robot(s) / End-Effector");
  await expect(references).toContainText("State / Action Check");
  await expect(references.locator(".layer-reference-card p, .layer-utility-caption")).toHaveCount(0);
  await expect(references).not.toContainText("Inverse Dynamic Model");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileColumns = await projectBody.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(mobileColumns).toBe(1);
  const [mobileUtilityBox, mobileDiagramBox] = await Promise.all([
    utility.boundingBox(),
    utility.locator(".layer-utility-diagram-svg").boundingBox(),
  ]);
  expect(mobileDiagramBox.y + mobileDiagramBox.height).toBeLessThanOrEqual(
    mobileUtilityBox.y + mobileUtilityBox.height + 1
  );
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

test("Passkey login unlocks the dashboard on a phone without persisting credential data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubPasskeyCredentials(page);
  const { passkeyState } = await mockDashboardApi(page, null, { passkeyAvailable: true });
  await page.goto("/dashboard/");

  const passkeyButton = page.getByRole("button", { name: "Use Passkey" });
  await expect(passkeyButton).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Dashboard Token" })).toBeVisible();
  await passkeyButton.click();
  await expect(page.locator("body")).not.toHaveClass(/dashboard-locked/);
  await expect(page.getByRole("heading", { name: "Embodied AI Project Dashboard" })).toBeVisible();

  expect(await page.evaluate(() => window.__dashboardPasskeyGetConverted)).toBe(true);
  expect(passkeyState.requests).toHaveLength(1);
  expect(passkeyState.requests[0]).toMatchObject({
    ceremony: "authentication",
    ceremony_id: "YXV0aGVudGljYXRpb24taWQ",
    response: {
      id: "YnJvd3Nlci1wYXNza2V5LWNyZWRlbnRpYWw",
      type: "public-key",
    },
  });
  const storage = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(storage).not.toContain("YnJvd3Nlci1wYXNza2V5LWNyZWRlbnRpYWw");
  expect(storage).not.toContain("authentication-signature-private-marker");
});

test("admin can add, rename, and remove a Passkey from Settings on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubPasskeyCredentials(page);
  const { passkeyState } = await mockDashboardApi(page);
  await unlockDashboard(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  const passkeySection = dialog.locator("[data-access-passkey-settings]");
  await expect(passkeySection).toBeVisible();
  await passkeySection.getByRole("textbox", { name: "Label (optional)" }).fill("iPhone");
  await passkeySection.getByRole("button", { name: "Add Passkey" }).click();
  await expect(passkeySection.getByRole("textbox", { name: "Passkey label for iPhone" })).toHaveValue("iPhone");
  expect(await page.evaluate(() => window.__dashboardPasskeyCreateConverted)).toBe(true);
  expect(passkeyState.passkeys).toHaveLength(1);

  const passkeyItem = passkeySection.locator("[data-access-passkey-rename]");
  const labelInput = passkeyItem.getByRole("textbox", { name: "Passkey label for iPhone" });
  await labelInput.fill("Personal iPhone");
  await passkeyItem.getByRole("button", { name: "Rename" }).click();
  await expect(passkeySection.getByRole("textbox", { name: "Passkey label for Personal iPhone" })).toHaveValue("Personal iPhone");

  page.once("dialog", async (confirmation) => { await confirmation.accept(); });
  await passkeySection.getByRole("button", { name: "Remove" }).click();
  await expect(passkeySection.getByText("No Passkeys yet.")).toBeVisible();
  expect(passkeyState.passkeys).toHaveLength(0);

  const bounds = await passkeySection.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain("YnJvd3Nlci1wYXNza2V5LWNyZWRlbnRpYWw");
  expect(storage).not.toContain("registration-attestation-private-marker");
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
  await expect(createForm).toBeHidden();
  await dialog.getByRole("button", { name: "Add dashboard user" }).click();
  await expect(createForm).toBeVisible();
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

test("admin settings can copy and rescope environment viewer tokens without browser persistence", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Ziyang/ }).click();
  const editForm = dialog.locator("[data-access-user-edit]");
  const createForm = dialog.locator("[data-access-user-create]");
  await expect(editForm).toBeVisible();
  await expect(createForm).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Add dashboard user" })).toBeVisible();
  await expect.poll(async () => dialog.locator(".access-user-list").evaluate((element) => ({
    x: getComputedStyle(element).overflowX,
    y: getComputedStyle(element).overflowY,
  }))).toEqual({ x: "auto", y: "hidden" });
  await expect.poll(async () => dialog.locator(".access-settings-layout").evaluate((element) => (
    getComputedStyle(element).overflowY
  ))).toBe("auto");
  await expect.poll(async () => dialog.locator(".access-settings-workspace").evaluate((element) => (
    getComputedStyle(element).overflowY
  ))).toBe("visible");
  expect(await dialog.evaluate(() => {
    const add = document.querySelector("[data-access-user-create-open]");
    const list = document.querySelector("[data-access-user-list]");
    if (!add || !list) return false;
    return add.getBoundingClientRect().bottom <= list.getBoundingClientRect().top;
  })).toBe(true);
  await expect(editForm.getByText("This token stays in the Vercel runtime environment. An authenticated administrator can copy it without storing it in dashboard state or browser storage.")).toBeVisible();
  await expect(editForm.getByRole("textbox", { name: "Name" })).toBeDisabled();
  await expect(editForm.getByRole("button", { name: "Regenerate & copy token" })).toHaveCount(0);
  await editForm.getByRole("button", { name: "Copy token", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "New dashboard access token" })).toHaveValue("environment_browser_test_token_1234567890");
  expect(await page.evaluate(() => window.__dashboardCopiedText || "")).toBe("environment_browser_test_token_1234567890");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("environment_browser_test_token_1234567890");

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
  await dialog.getByRole("button", { name: "Close dashboard access settings" }).click();
  await expect(page.locator("[data-access-token-value]")).toHaveValue("");
});

test("disabled environment viewers do not expose a copy action", async ({ page }) => {
  await mockDashboardApi(page, null, { environmentEnabled: false });
  await unlockDashboard(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  await dialog.locator('.access-user-item[data-access-user-id="env_ziyang_browser"]').click();
  const editForm = dialog.locator("[data-access-user-edit]");
  await expect(editForm.getByRole("checkbox", { name: "Access enabled" })).not.toBeChecked();
  await expect(editForm.getByRole("button", { name: "Copy token", exact: true })).toHaveCount(0);
});

test("admin can permanently remove a managed duplicate and keep the environment credential", async ({ page }) => {
  await mockDashboardApi(page, null, { includeManagedDuplicate: true });
  await unlockDashboard(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Dashboard access" });
  await dialog.locator('[data-access-user-id="user_ziyang_duplicate"]').click();
  const editForm = dialog.locator("[data-access-user-edit]");
  await expect(editForm.getByRole("button", { name: "Delete user permanently" })).toBeVisible();
  page.once("dialog", async (confirmation) => { await confirmation.accept(); });
  await editForm.getByRole("button", { name: "Delete user permanently" }).click();

  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/dashboard/access-users");
    const data = await response.json();
    return data.users.filter((user) => user.viewer === "Ziyang").map((user) => user.managed_by);
  })).toEqual(["environment"]);
  await expect(dialog.locator('.access-user-item[data-access-user-id="env_ziyang_browser"]')).toBeVisible();
  await expect(editForm.getByRole("button", { name: "Copy token", exact: true })).toBeVisible();
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
      await request("POST", { action: "copy", user_id: "env_ziyang_browser" }),
      await request("POST", { action: "delete", user_id: "user_browser_viewer" }),
      await request("PATCH", { user_id: "env_ziyang_browser", visibility: { bucket_ids: ["archive"], include_project_ids: [], exclude_project_ids: [] } }),
      await request("DELETE", { user_id: "env_ziyang_browser" }),
    ];
  });
  expect(forbiddenStatuses).toEqual([403, 403, 403, 403, 403, 403]);
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

test("UMI intro and linked method index default to the automatic collapsed state", async ({ page }) => {
  await mockDashboardApi(page);
  await unlockDashboard(page);

  const project = page.locator('details.project-detail[data-project-id="umi-world-model"]');
  const intro = project.locator(".project-intro");
  const toggle = project.locator(".project-intro-toggle");
  const references = project.locator(".layer-reference-grid");
  const timeline = intro.locator(":scope > .timeline-strip");
  const subprojects = intro.locator(":scope > .subproject-grid");
  const details = intro.locator(":scope > ul");
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(intro).not.toHaveAttribute("role", "button");
  await expect(intro).toHaveAttribute("aria-hidden", "true");
  expect(await intro.evaluate((element) => element.inert)).toBe(true);
  await expect(references).toBeHidden();
  await expect(timeline).toBeHidden();
  await expect(timeline).toHaveAttribute("aria-hidden", "true");
  await expect(subprojects).toBeHidden();
  await expect(details).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(intro).toHaveAttribute("aria-hidden", "false");
  expect(await intro.evaluate((element) => element.inert)).toBe(false);
  await expect(references).toBeVisible();
  await expect(timeline).toBeVisible();
  await expect(timeline).toHaveAttribute("aria-hidden", "false");
  await expect(subprojects).toBeVisible();
  await expect(details).toBeVisible();

  await intro.evaluate((element) => {
    const link = document.createElement("a");
    link.href = "https://example.com/intro-reference";
    link.textContent = "Injected intro reference";
    element.append(link);
  });
  const firstLink = intro.locator("a", { hasText: "Injected intro reference" });
  await firstLink.focus();
  expect(await intro.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(references).toBeHidden();
  await expect(timeline).toBeHidden();
  await expect(subprojects).toBeHidden();
  await expect(details).toBeHidden();
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
