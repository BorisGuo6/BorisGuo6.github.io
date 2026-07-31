import {
  handleDashboardProjectTableRowUpdate,
  handleDashboardProjectUpdate,
  withDashboardApiErrors,
} from "../../scripts/dashboard-vercel-api.mjs";

export function handleDashboardProjectMutation(request, response) {
  const operation = Array.isArray(request.query?.operation)
    ? request.query.operation[0]
    : request.query?.operation;
  if (operation === "project-update") {
    return handleDashboardProjectUpdate(request, response);
  }
  return handleDashboardProjectTableRowUpdate(request, response);
}

export default withDashboardApiErrors(handleDashboardProjectMutation);
