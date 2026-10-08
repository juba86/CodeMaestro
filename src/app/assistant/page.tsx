import { Suspense } from "react";
import { AssistantPage } from "@/components/assistant/assistant-page";

export default function Page() {
  // AssistantPage reads ?session= / ?new= (deep links) via useSearchParams.
  // The route is full-bleed: the page manages its own panes and scrolling.
  return (
    <Suspense fallback={<div className="flex min-h-0 flex-1 bg-background" aria-busy="true" />}>
      <AssistantPage />
    </Suspense>
  );
}
