import {
  handleDashboardPasskeyOptions,
  handleDashboardPasskeyVerify,
  handleDashboardPasskeys,
  withDashboardApiErrors,
} from "../../scripts/dashboard-vercel-api.mjs";

async function handleDashboardPasskeyRoute(request, response) {
  const action = new URL(request.url || "/api/dashboard/passkeys", "https://jingxiangguo.com")
    .searchParams
    .get("action");
  if (action === "options") return handleDashboardPasskeyOptions(request, response);
  if (action === "verify") return handleDashboardPasskeyVerify(request, response);
  return handleDashboardPasskeys(request, response);
}

export default withDashboardApiErrors(handleDashboardPasskeyRoute);
