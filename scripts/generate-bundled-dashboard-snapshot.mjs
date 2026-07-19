import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  dashboardStateToSnapshot,
  serializeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import { loadDashboardState, repoRoot } from "./dashboard-state-lib.mjs";

const snapshot = dashboardStateToSnapshot(await loadDashboardState(), {
  source: "bundled-json-generated",
});
const serialized = serializeDashboardSnapshot(snapshot);
const outputPath = path.join(repoRoot, "scripts", "dashboard-bundled-state.generated.mjs");
await writeFile(outputPath, `export default ${serialized.trimEnd()};\n`, "utf8");
console.log(`bundled dashboard snapshot generated at ${path.relative(repoRoot, outputPath)}`);
