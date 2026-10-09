-- Shared work journal per working directory, and how far each session's
-- agent has been told about it (src/lib/assistant/work-journal.ts).

-- AlterTable
ALTER TABLE "AssistantSession" ADD COLUMN "syncedAt" DATETIME;

-- CreateTable
CREATE TABLE "WorkLogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cwd" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "files" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'done',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WorkLogEntry_cwd_createdAt_idx" ON "WorkLogEntry"("cwd", "createdAt");

