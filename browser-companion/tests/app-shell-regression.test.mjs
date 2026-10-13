import assert from "node:assert/strict";
import fs from "node:fs";

const rootRoute = fs.readFileSync(new URL("../../src/routes/__root.tsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(
  new URL("../../src/components/sidebar.tsx", import.meta.url),
  "utf8",
);

assert.match(
  rootRoute,
  /\{\(!isPublicPage \|\| classic\) && <Sidebar \/>\}/,
  "public premium pages should stay focused while classic keeps the application sidebar",
);
assert.doesNotMatch(
  rootRoute,
  /<MusicPlayer\s*\/>|<PomodoroTimer\s*\/>/,
  "timer and music controls must remain absent from the application shell",
);
assert.match(
  sidebar,
  /label: "Browser Companion", to: "\/companion-setup"/,
  "the persistent desktop sidebar must include Browser Companion setup and plan access",
);

console.log("PASS application shell regression checks");
