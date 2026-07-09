import { handleDashboardProjectTableRowUpdate, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardProjectTableRowUpdate);
