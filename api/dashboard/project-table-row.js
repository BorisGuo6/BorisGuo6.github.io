import { handleDashboardProjectTableRowUpdate } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardProjectTableRowUpdate(request, response);
}
