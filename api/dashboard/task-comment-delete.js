import { handleDashboardTaskCommentDelete } from "../../scripts/dashboard-vercel-api.mjs";

export default async function handler(request, response) {
  return handleDashboardTaskCommentDelete(request, response);
}
