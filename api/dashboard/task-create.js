import { handleDashboardTaskCreate } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardTaskCreate(request, response);
}
