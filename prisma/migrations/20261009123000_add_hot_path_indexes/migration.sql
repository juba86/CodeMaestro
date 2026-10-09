-- Indexes for the hot read paths: the session list / activity snapshot
-- (ORDER BY updatedAt), transcripts (WHERE sessionId ORDER BY createdAt)
-- and the prompt library list (ORDER BY updatedAt).

-- CreateIndex
CREATE INDEX "Prompt_updatedAt_idx" ON "Prompt"("updatedAt");

-- CreateIndex
CREATE INDEX "AssistantSession_updatedAt_idx" ON "AssistantSession"("updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_sessionId_createdAt_idx" ON "AssistantMessage"("sessionId", "createdAt");
