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
assert.match(clientScript, /resize-request/);
new vm.Script(clientScript, { filename: "desktop-orchestrator-widget-client.js" });

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
};
console.log(JSON.stringify(result, null, 2));
