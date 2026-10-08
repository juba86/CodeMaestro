"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function retry() {
  // The worker serves the offline page under the URL that failed — a reload
  // retries exactly that page.
  if (window.location.pathname === "/offline") window.location.assign("/");
  else window.location.reload();
}

/**
 * "Erneut versuchen". A real link to the current URL (href=""), so it also
 * retries without JavaScript; with JavaScript it retries automatically as
 * soon as the device is back online.
 */
export function RetryButton() {
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  return (
    <Button asChild variant="primary" size="lg">
      <a
        href=""
        onClick={(e) => {
          e.preventDefault();
          retry();
        }}
      >
        <RefreshCw aria-hidden="true" />
        Erneut versuchen
      </a>
    </Button>
  );
}
