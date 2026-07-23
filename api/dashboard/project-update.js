import { handleDashboardProjectUpdate, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardProjectUpdate);
