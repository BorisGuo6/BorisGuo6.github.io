import { handleDashboardTaskCommentDelete, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardTaskCommentDelete);
