import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const requireText = (file, patterns) => {
  const source = readFileSync(file, "utf8");
  for (const [pattern, message] of patterns) {
    if (!pattern.test(source)) failures.push(`${file}: ${message}`);
  }
};
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") ? [path] : [];
});

for (const [dir, owner] of [
  ["ports", "handlers/ (application-implemented contracts live beside the handler that dispatches them)"],
  ["services", "handlers/ for use-case helpers and saga.ts beside cqrs.ts"],
  ["analytics", "domain/analytics with repos/metric.repo.ts and analytics handlers"],
]) {
  if (existsSync(dir)) failures.push(`${dir}/: retired; code belongs in ${owner}`);
}

const layers = ["domain", "handlers", "repos", "shared"];
for (const file of [...layers.flatMap(sources), "cqrs.ts", "saga.ts"]) {
  const source = readFileSync(file, "utf8");
  if (/from\s+["'](?:nuxt|h3|vue|#imports|node:)/.test(source)) {
    failures.push(`${file}: @ruxt/core must stay framework- and runtime-free`);
  }
  if (file.startsWith("domain/") && /from\s+["']\.\.\/(?:\.\.\/)*(?:handlers|repos)\//.test(source)) {
    failures.push(`${file}: domain must not depend on handlers or repository ports`);
  }
  if (file.startsWith("repos/") && /from\s+["']\.\.\/handlers\//.test(source)) {
    failures.push(`${file}: repository ports must not depend on handlers`);
  }
}

requireText("packages/editor/app/components/CodePreview.vue", [
  [/prefix:\s*"\.cv-preview-scope"/, "document CSS must remain scoped to prevent template style leaks"],
]);

if (failures.length) {
  console.error(`Architecture lint failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Architecture lint passed");
