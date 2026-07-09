import { handleDashboardTaskComment, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardTaskComment);
