import { handleDashboardHealth } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardHealth(request, response);
}
