import { Suspense } from "react";
import { PlaygroundView } from "@/components/playground/playground-view";

export default function PlaygroundPage() {
  // PlaygroundView reads ?prompt=<id> (useSearchParams).
  return (
    <Suspense fallback={null}>
      <PlaygroundView />
    </Suspense>
  );
}
