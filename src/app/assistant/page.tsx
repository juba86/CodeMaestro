import { Suspense } from "react";
import { AssistantView } from "@/components/assistant/assistant-view";

export default function AssistantPage() {
  // AssistantView reads ?session= (deep links) via useSearchParams.
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Code Assistant wird geladen…</div>}>
      <AssistantView />
    </Suspense>
  );
}
