const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "lib", "api-base.ts"), "utf8")
  .replaceAll("export ", "")
  .replace(/: string(?=[,)=])/g, "");
const { apiBaseUrl, apiPath } = new Function(`${source}; return { apiBaseUrl, apiPath };`)();

assert.equal(apiBaseUrl(undefined), "");
assert.equal(apiPath("/api/v1/health-number", undefined), "/api/v1/health-number");
assert.equal(apiPath("api/v1/health-number", "http://127.0.0.1:8000/"), "http://127.0.0.1:8000/api/v1/health-number");
console.log("api-base behavior: PASS");
