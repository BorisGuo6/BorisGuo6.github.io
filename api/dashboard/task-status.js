import { handleDashboardTaskStatus } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardTaskStatus(request, response);
}
