-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN "costUsd" REAL;
ALTER TABLE "TestResult" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "TestResult" ADD COLUMN "outputTokens" INTEGER;

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "input" TEXT NOT NULL DEFAULT '',
    "matchType" TEXT NOT NULL DEFAULT 'contains',
    "expected" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestCase_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TestCase_promptId_idx" ON "TestCase"("promptId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_createdAt_idx" ON "KnowledgeDoc"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_docId_idx" ON "KnowledgeChunk"("docId");

-- CreateIndex
CREATE INDEX "PromptVersion_createdAt_idx" ON "PromptVersion"("createdAt");

-- CreateIndex
CREATE INDEX "TestResult_createdAt_idx" ON "TestResult"("createdAt");
