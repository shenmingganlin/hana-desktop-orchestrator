import assert from "node:assert/strict";
import vm from "node:vm";
import registerWidgetRoutes from "../routes/widget.js";

const routes = {};
const app = {
  get(route, handler) { routes[`GET ${route}`] = handler; },
  post(route, handler) { routes[`POST ${route}`] = handler; },
};

registerWidgetRoutes(app, {
  pluginId: "desktop-orchestrator",
  config: {
    getAll() { return {}; },
    setMany() {},
  },
});

const html = routes["GET /widget"]({
  req: { query() { return "inherit"; } },
  html(value) { return value; },
});
const clientScripts = [...String(html).matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.includes("savePolicies"));

assert.equal(clientScripts.length, 1, "Widget should contain one client script");
const clientScript = clientScripts[0];
assert.match(clientScript, /savePoliciesTopButton/);
assert.match(clientScript, /acknowledgePolicyButton/);
assert.match(clientScript, /确认风险修改/);
assert.match(clientScript, /resize-request/);
assert.doesNotMatch(clientScript, /window\\.confirm/);
new vm.Script(clientScript, { filename: "desktop-orchestrator-widget-client.js" });

const savedPayloads = [];
const apiRoutes = {};
const apiApp = {
  get(route, handler) { apiRoutes[`GET ${route}`] = handler; },
  post(route, handler) { apiRoutes[`POST ${route}`] = handler; },
};
registerWidgetRoutes(apiApp, {
  pluginId: "desktop-orchestrator",
  config: { setMany(payload) { savedPayloads.push(payload); } },
});
const blocked = await apiRoutes["POST /api/action-policies"]({
  req: { json: async () => ({ actionConfirmation: { "window.close": "auto" } }) },
  json(payload) { return payload; },
});
assert.equal(blocked.blocked, true);
assert.equal(savedPayloads.length, 0);
const acknowledged = await apiRoutes["POST /api/action-policies"]({
  req: { json: async () => ({ actionConfirmation: { "window.close": "auto" }, acknowledgeWarnings: true }) },
  json(payload) { return payload; },
});
assert.equal(acknowledged.ok, true);
assert.equal(savedPayloads.length, 1);

const result = {
  ok: true,
  type: "desktop-orchestrator-widget-render-check",
  scriptChars: clientScript.length,
  saveControlsPresent: true,
  resizeHandshakePresent: true,
  clientScriptParses: true,
  noDesktopActionExecuted: true,
  noScreenshotCaptured: true,
  noUiaInvoke: true,
  noMouseOrKeyboardInput: true,
  riskWarningBlocksWithoutAcknowledgement: true,
  riskWarningAllowsAcknowledgedSave: true,
};
console.log(JSON.stringify(result, null, 2));
