import { Suspense } from "react";
import { PromptLibrary } from "@/components/library/prompt-library";

export default function LibraryPage() {
  // PromptLibrary reads ?prompt=<id> (useSearchParams).
  return (
    <Suspense fallback={null}>
      <PromptLibrary />
    </Suspense>
  );
}
