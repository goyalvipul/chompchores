const fs = require("fs");
const crypto = require("crypto");
const input = process.argv[2] || "/tmp/mini.json";
const out = process.argv[3] || "/tmp/import-out";
const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const householdId = crypto.randomUUID();
const idMap = {};
for (const u of raw.users || []) idMap[u.id] = crypto.randomUUID();
const summary = {
  source: input,
  householdId,
  users: (raw.users || []).length,
  chores: (raw.chores || []).length,
  rewards: (raw.rewards || []).length,
  dryRun: true,
  note: "Live Docker JSON not modified",
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + "/summary.json", JSON.stringify(summary, null, 2));
fs.writeFileSync(out + "/id-map.json", JSON.stringify({ householdId, idMap }, null, 2));
console.log(JSON.stringify(summary, null, 2));
