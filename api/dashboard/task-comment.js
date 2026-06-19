import { handleDashboardTaskComment } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardTaskComment(request, response);
}
