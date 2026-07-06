import { handleDashboardAuditLog } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardAuditLog(request, response);
}
