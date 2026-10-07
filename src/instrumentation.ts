// Runs once when the server process starts. Assistant runs live in the
// in-memory run hub (src/lib/assistant/run-hub.ts) and their CLI processes never
// survive a restart, so the hub starts empty and any session the DB still shows
// as "running" (server restarted mid-run) is stale — reset it to "idle" so the
// session list is accurate. This happens before the Telegram bridge starts and
// before any request is served, so it can't clobber a live run's status.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { prisma } = await import("@/lib/db/client");
      await prisma.assistantSession.updateMany({
        where: { status: "running" },
        data: { status: "idle" },
      });
    } catch {
      /* best effort */
    }

    // Auto-start the optional Telegram bridge if it was enabled in the PWA, so
    // the assistant stays reachable from Telegram after a server restart.
    try {
      const { getTelegramConfig } = await import("@/lib/assistant/telegram-config");
      const cfg = await getTelegramConfig();
      if (cfg.enabled && cfg.token) {
        const { startBridge } = await import("@/lib/assistant/telegram");
        await startBridge();
      }
    } catch {
      /* bridge is optional — never block boot */
    }
  }
}
