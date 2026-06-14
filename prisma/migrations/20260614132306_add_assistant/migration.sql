-- CreateTable
CREATE TABLE "AssistantSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'claude',
    "model" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "cwd" TEXT NOT NULL,
    "permissionMode" TEXT NOT NULL DEFAULT 'default',
    "allowedTools" TEXT NOT NULL DEFAULT 'Read,Grep,Glob',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "totalCostUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantSession_externalId_key" ON "AssistantSession"("externalId");

-- CreateIndex
CREATE INDEX "AssistantSession_createdAt_idx" ON "AssistantSession"("createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_sessionId_idx" ON "AssistantMessage"("sessionId");
