import { handleDashboardTaskUpdate, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardTaskUpdate);
