import { handleDashboardState } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardState(request, response);
}
