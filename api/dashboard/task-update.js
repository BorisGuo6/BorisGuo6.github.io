import { handleDashboardTaskUpdate } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardTaskUpdate(request, response);
}
