export async function activate(ctx) {
  ctx?.log?.info?.("desktop-orchestrator activated");
}

export async function deactivate(ctx) {
  ctx?.log?.info?.("desktop-orchestrator deactivated");
}
