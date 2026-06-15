-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssistantSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'claude',
    "model" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "cwd" TEXT NOT NULL,
    "permissionMode" TEXT NOT NULL DEFAULT 'default',
    "allowedTools" TEXT NOT NULL DEFAULT 'Read,Grep,Glob',
    "approvalMode" TEXT NOT NULL DEFAULT 'off',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "totalCostUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AssistantSession" ("allowedTools", "createdAt", "cwd", "externalId", "id", "model", "permissionMode", "provider", "status", "title", "totalCostUsd", "updatedAt") SELECT "allowedTools", "createdAt", "cwd", "externalId", "id", "model", "permissionMode", "provider", "status", "title", "totalCostUsd", "updatedAt" FROM "AssistantSession";
DROP TABLE "AssistantSession";
ALTER TABLE "new_AssistantSession" RENAME TO "AssistantSession";
CREATE UNIQUE INDEX "AssistantSession_externalId_key" ON "AssistantSession"("externalId");
CREATE INDEX "AssistantSession_createdAt_idx" ON "AssistantSession"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
