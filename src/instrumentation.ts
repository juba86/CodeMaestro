// Runs once when the server process starts. Assistant CLI processes never
// survive a restart, so any session left in "running" (e.g. the server was
// restarted mid-turn) is stale — reset it to "idle" so the status is accurate
// and the concurrency guard works.
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
