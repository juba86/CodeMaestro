"use client";

export function RetryButton() {
  const retry = () => {
    // The worker serves the offline page under the URL that failed — a reload
    // retries exactly that page.
    if (window.location.pathname === "/offline") window.location.assign("/");
    else window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={retry}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      Erneut versuchen
    </button>
  );
}
