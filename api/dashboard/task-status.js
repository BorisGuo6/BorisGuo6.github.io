import { handleDashboardTaskStatus, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardTaskStatus);
