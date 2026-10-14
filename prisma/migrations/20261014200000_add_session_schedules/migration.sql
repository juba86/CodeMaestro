-- Schedules: a session runs a task on its own, on a cron rhythm and/or by
-- webhook (src/lib/schedule/). Deleted with the session.

-- CreateTable
CREATE TABLE "SessionSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "cron" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'turn',
    "loop" TEXT NOT NULL DEFAULT '{}',
    "useKnowledge" BOOLEAN NOT NULL DEFAULT false,
    "onBusy" TEXT NOT NULL DEFAULT 'skip',
    "onlyIfChanged" BOOLEAN NOT NULL DEFAULT false,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,
    "maxRuns" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerToken" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failStreak" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "lastSummary" TEXT NOT NULL DEFAULT '',
    "lastFingerprint" TEXT NOT NULL DEFAULT '',
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionSchedule_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionSchedule_triggerToken_key" ON "SessionSchedule"("triggerToken");

-- CreateIndex
CREATE INDEX "SessionSchedule_sessionId_idx" ON "SessionSchedule"("sessionId");

-- CreateIndex
CREATE INDEX "SessionSchedule_enabled_nextRunAt_idx" ON "SessionSchedule"("enabled", "nextRunAt");
