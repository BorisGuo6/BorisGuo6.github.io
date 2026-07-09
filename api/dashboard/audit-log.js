import { handleDashboardAuditLog, withDashboardApiErrors } from "../../scripts/dashboard-vercel-api.mjs";

export default withDashboardApiErrors(handleDashboardAuditLog);
