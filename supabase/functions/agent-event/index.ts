import { createClient } from "jsr:@supabase/supabase-js@2";

type AgentEventPayload = {
  action?: string;
  agent_id?: string;
  portfolio_id?: string;
  project_id?: string;
  task_id?: string;
  comment_id?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  summary?: string;
  comment?: string;
  kind?: string;
  run_id?: string;
  event_type?: string;
  git_sha?: string;
  command?: string;
  exit_code?: number;
  log_path?: string;
  metrics_path?: string;
  verifier?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

const allowedActions = new Set([
  "heartbeat",
  "portfolio_update",
  "project_upsert",
  "project_delete",
  "project_update",
  "task_upsert",
  "task_delete",
  "task_status",
  "task_comment",
  "comment_delete",
  "run",
]);
const allowedTaskStatuses = new Set(["todo", "active", "blocked", "needs_user", "review", "done"]);
const allowedTaskPriorities = new Set(["low", "medium", "high", "urgent"]);
const allowedProjectBuckets = new Set(["active", "engineering", "research", "archive"]);
const allowedProjectStatuses = new Set(["ongoing", "survey", "blocked", "done", "paused"]);
const allowedCommentKinds = new Set(["comment", "result", "status_change", "needs_user", "blocker", "verification"]);
const commentKindAliases = new Map([
  ["progress", "comment"],
  ["conductor_reply", "comment"],
  ["conductor_note", "comment"],
  ["blocker_resolved", "comment"],
  ["review", "comment"],
  ["artifact", "comment"],
  ["host_verified", "verification"],
]);
const allowedInputCommentKinds = new Set([...allowedCommentKinds, ...commentKindAliases.keys()]);
const allowedRunStatuses = new Set(["not_run", "running", "started", "failed", "passed", "verified"]);
const maxCommentLength = 4000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getServiceKey(): string {
  const configuredKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY");
  if (configuredKey) return configuredKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS");
  }

  const parsed = JSON.parse(secretKeys) as Record<string, string>;
  return parsed.service_role || parsed.service || Object.values(parsed)[0];
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

function requireBoundedString(value: unknown, name: string, maxLength: number): string {
  const text = requireString(value, name);
  if (text.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or fewer`);
  }
  return text;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requireEnum(value: unknown, name: string, allowed: Set<string>, fallback?: string): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!candidate || !allowed.has(candidate)) {
    throw new Error(`Invalid ${name}: ${String(value)}`);
  }
  return candidate;
}

function normalizeCommentKind(value: unknown): string {
  const rawKind = requireEnum(value, "kind", allowedInputCommentKinds, "comment");
  return commentKindAliases.get(rawKind) || rawKind;
}

function isNoisyHarnessComment(kind: string, body: string): boolean {
  if (["conductor_reply", "conductor_note"].includes(kind)) return true;
  if (body.startsWith("本机主控已向远端 session")) return true;
  if (body.startsWith("本机主控拦截到疑似危险输入请求")) return true;
  return body.includes("session_") && (body.includes("本机主控") || body.includes("ClawCross"));
}

function optionalInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const expectedToken = Deno.env.get("AGENT_WRITE_TOKEN");
    if (!expectedToken) throw new Error("Missing AGENT_WRITE_TOKEN");
    if (request.headers.get("x-agent-token") !== expectedToken) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = requireString(Deno.env.get("SUPABASE_URL"), "SUPABASE_URL");
    const supabase = createClient(supabaseUrl, getServiceKey(), {
      auth: { persistSession: false },
    });
    const body = (await request.json()) as AgentEventPayload;
    const action = body.action || "event";
    if (!allowedActions.has(action)) {
      throw new Error(`Unknown action: ${action}`);
    }

    const agentId = body.agent_id;
    const projectId = body.project_id;
    const taskId = body.task_id;
    const payload = body.payload || {};
    let eventAgentId: string | null = null;
    let eventProjectId: string | null = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;

    async function resolveTaskProjectId(task_id: string): Promise<string> {
      const { data, error } = await supabase
        .from("tasks")
        .select("project_id")
        .eq("task_id", task_id)
        .single();
      if (error) throw error;
      return data.project_id;
    }

    async function ensureAgentRecord(project_id: string, status = "running"): Promise<string | null> {
      if (!agentId) return null;
      const agent_id = requireString(agentId, "agent_id");
      const { error } = await supabase.from("agents").upsert({
        agent_id,
        project_id,
        status,
        current_task_id: taskId || null,
        summary: body.summary || null,
        payload,
        last_heartbeat_at: new Date().toISOString(),
      }, { onConflict: "agent_id" });
      if (error) throw error;
      return agent_id;
    }

    function validateVerifiedRun(status: string): void {
      if (!["passed", "verified"].includes(status)) return;
      const verifier = body.verifier || {};
      if (verifier.status !== "passed") {
        throw new Error("passed/verified runs require verifier.status='passed'");
      }
      if (optionalInteger(body.exit_code) !== 0) {
        throw new Error("passed/verified runs require exit_code=0");
      }
      if (!optionalString(body.git_sha)) {
        throw new Error("passed/verified runs require git_sha");
      }
      if (!optionalString(body.command)) {
        throw new Error("passed/verified runs require command");
      }
    }

    if (action === "heartbeat") {
      const agent_id = requireString(agentId, "agent_id");
      const project_id = requireString(projectId, "project_id");
      const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : "running";
      const { error } = await supabase.from("agents").upsert({
        agent_id,
        project_id,
        status,
        current_task_id: taskId || null,
        summary: body.summary || null,
        payload,
        last_heartbeat_at: new Date().toISOString(),
      }, { onConflict: "agent_id" });
      if (error) throw error;
      eventAgentId = agent_id;
    } else if (action === "portfolio_update") {
      const portfolio_id = requireString(body.portfolio_id || payload.portfolio_id || "embodied-ai-dashboard", "portfolio_id");
      const title = requireString(body.title || payload.title, "title");
      const week = requireString(payload.week, "week");
      const row = {
        portfolio_id,
        title,
        subtitle: optionalString(payload.subtitle),
        week,
        report_date: optionalString(payload.report_date),
        summary: payload.summary || {},
        storyline: payload.storyline || {},
        visual_references: payload.visual_references || [],
        weekly_briefs: payload.weekly_briefs || [],
        project_buckets: payload.project_buckets || [],
        rules: payload.rules || [],
        timeline_policy: payload.timeline_policy || {},
        source_updated_at: optionalString(payload.source_updated_at),
      };
      const { error } = await supabase
        .from("portfolio_snapshots")
        .upsert(row, { onConflict: "portfolio_id" })
        .select("portfolio_id")
        .single();
      if (error) throw error;
    } else if (action === "project_upsert") {
      const project_id = requireString(projectId, "project_id");
      const title = requireString(body.title || payload.title, "title");
      const bucket = requireEnum(payload.bucket, "bucket", allowedProjectBuckets, "active");
      const status = requireEnum(body.status || payload.status, "status", allowedProjectStatuses, "ongoing");
      const sortOrder = optionalInteger(payload.sort_order);
      eventProjectId = project_id;
      const row: Record<string, unknown> = {
        project_id,
        title,
        bucket,
        status,
        description: optionalString(body.description || payload.description) || "",
        summary: optionalString(body.summary || payload.summary) || "",
        asset: optionalString(payload.asset),
        asset_alt: optionalString(payload.asset_alt),
        asset_caption: optionalString(payload.asset_caption),
        visual: payload.visual || null,
        details: payload.details || [],
        timeline: payload.timeline || null,
        risks_decisions: payload.risks_decisions || [],
        source_updated_at: optionalString(payload.source_updated_at),
      };
      if (sortOrder !== null) row.sort_order = sortOrder;
      const { error } = await supabase
        .from("projects")
        .upsert(row, { onConflict: "project_id" })
        .select("project_id")
        .single();
      if (error) throw error;
      if (agentId) eventAgentId = await ensureAgentRecord(project_id);
    } else if (action === "project_update") {
      const project_id = requireString(projectId, "project_id");
      eventProjectId = project_id;
      const update: Record<string, unknown> = {};
      for (const key of ["description", "summary", "asset_caption", "source_updated_at"]) {
        if (key in payload) update[key] = optionalString(payload[key]);
      }
      for (const key of ["details", "timeline", "risks_decisions"]) {
        if (key in payload) update[key] = payload[key];
      }
      if ("sort_order" in payload) {
        const sortOrder = optionalInteger(payload.sort_order);
        if (sortOrder === null) throw new Error("Invalid sort_order");
        update.sort_order = sortOrder;
      }
      if (Object.keys(update).length === 0) {
        throw new Error("project_update requires at least one supported field");
      }
      const { error } = await supabase
        .from("projects")
        .update(update)
        .eq("project_id", project_id)
        .select("project_id")
        .single();
      if (error) throw error;
      if (agentId) eventAgentId = await ensureAgentRecord(project_id);
    } else if (action === "project_delete") {
      const project_id = requireString(projectId, "project_id");
      eventProjectId = project_id;
      await supabase
        .from("agents")
        .delete()
        .eq("project_id", project_id);
      await supabase
        .from("runs")
        .delete()
        .eq("project_id", project_id);
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("project_id", project_id)
        .select("project_id")
        .single();
      if (error) throw error;
      eventProjectId = null;
    } else if (action === "task_upsert") {
      const task_id = requireString(taskId, "task_id");
      const project_id = requireString(projectId, "project_id");
      const title = requireString(body.title || payload.title, "title");
      const description = optionalString(body.description || payload.description);
      const status = requireEnum(body.status, "status", allowedTaskStatuses, "todo");
      const priority = requireEnum(body.priority, "priority", allowedTaskPriorities, "medium");
      const sortOrder = optionalInteger(payload.sort_order);
      eventProjectId = project_id;
      const row: Record<string, unknown> = {
        task_id,
        project_id,
        title,
        description,
        status,
        priority,
        assignee: optionalString(payload.assignee),
        due_at: optionalString(payload.due_at),
        completed_at: optionalString(payload.completed_at),
        source_updated_at: optionalString(payload.source_updated_at),
        payload: payload.payload || { source: "agent-event" },
      };
      if (sortOrder !== null) row.sort_order = sortOrder;
      const { error } = await supabase
        .from("tasks")
        .upsert(row, { onConflict: "task_id" })
        .select("task_id")
        .single();
      if (error) throw error;
      if (agentId) eventAgentId = await ensureAgentRecord(project_id);
    } else if (action === "task_delete") {
      const task_id = requireString(taskId, "task_id");
      eventProjectId = await resolveTaskProjectId(task_id);
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("task_id", task_id)
        .select("task_id")
        .single();
      if (error) throw error;
    } else if (action === "task_status") {
      const task_id = requireString(taskId, "task_id");
      const status = requireEnum(body.status, "status", allowedTaskStatuses);
      eventProjectId = await resolveTaskProjectId(task_id);
      const requestedCompletedAt = optionalString(payload.completed_at);
      const update: Record<string, unknown> = {
        status,
        completed_at: status === "done" ? requestedCompletedAt || new Date().toISOString().slice(0, 10) : null,
      };
      if ("assignee" in payload) update.assignee = optionalString(payload.assignee);
      if ("due_at" in payload) update.due_at = optionalString(payload.due_at);
      if ("run_id" in payload && payload.run_id) update.payload = payload;
      const { error } = await supabase
        .from("tasks")
        .update(update)
        .eq("task_id", task_id)
        .select("task_id")
        .single();
      if (error) throw error;
      if (agentId) eventAgentId = await ensureAgentRecord(eventProjectId);
    } else if (action === "task_comment") {
      const task_id = requireString(taskId, "task_id");
      eventProjectId = await resolveTaskProjectId(task_id);
      const comment = requireBoundedString(body.comment, "comment", maxCommentLength);
      const rawKind = requireEnum(body.kind, "kind", allowedInputCommentKinds, "comment");
      const kind = commentKindAliases.get(rawKind) || rawKind;
      const comment_id = optionalString(body.comment_id) || `comment_${crypto.randomUUID()}`;
      if (!isNoisyHarnessComment(rawKind, comment)) {
        const commentRow: Record<string, unknown> = {
          comment_id,
          task_id,
          author: optionalString(payload.author) || agentId || "agent",
          author_type: "system",
          kind,
          body: comment,
        };
        const createdAt = optionalString(payload.created_at);
        if (createdAt) commentRow.created_at = createdAt;
        const { error } = await supabase.from("task_comments").upsert(commentRow, { onConflict: "comment_id" });
        if (error) throw error;
      }
      if (agentId) eventAgentId = await ensureAgentRecord(eventProjectId);
    } else if (action === "comment_delete") {
      const comment_id = requireString(body.comment_id, "comment_id");
      const task_id = requireString(taskId, "task_id");
      eventProjectId = await resolveTaskProjectId(task_id);
      const { error } = await supabase
        .from("task_comments")
        .delete()
        .eq("comment_id", comment_id)
        .eq("task_id", task_id)
        .select("comment_id")
        .single();
      if (error) throw error;
      if (agentId) eventAgentId = await ensureAgentRecord(eventProjectId);
    } else if (action === "run") {
      const run_id = requireString(body.run_id, "run_id");
      const project_id = requireString(projectId, "project_id");
      const status = requireEnum(body.status, "status", allowedRunStatuses, "not_run");
      validateVerifiedRun(status);
      if (taskId) {
        const taskProjectId = await resolveTaskProjectId(requireString(taskId, "task_id"));
        if (taskProjectId !== project_id) {
          throw new Error(`task_id does not belong to project_id: ${String(taskId)}`);
        }
      }
      eventProjectId = project_id;
      eventAgentId = await ensureAgentRecord(project_id);
      const { error } = await supabase.from("runs").upsert({
        run_id,
        project_id,
        task_id: taskId || null,
        agent_id: eventAgentId,
        status,
        git_sha: optionalString(body.git_sha),
        command: optionalString(body.command),
        exit_code: optionalInteger(body.exit_code),
        log_path: optionalString(body.log_path),
        metrics_path: optionalString(body.metrics_path),
        verifier: body.verifier || {},
        payload,
      }, { onConflict: "run_id" });
      if (error) throw error;
    }

    const { error: eventError } = await supabase.from("agent_events").insert({
      agent_id: eventAgentId,
      project_id: eventProjectId,
      task_id: action === "task_delete" ? null : taskId || null,
      event_type: body.event_type || action,
      payload: body,
    });
    if (eventError) throw eventError;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
});
