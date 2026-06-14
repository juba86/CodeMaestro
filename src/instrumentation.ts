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
  }
}
