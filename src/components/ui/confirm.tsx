"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  /** Default „Bestätigen". */
  confirmLabel?: string;
  /** Default „Abbrechen". */
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface Request {
  id: number;
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
  /** Focused when confirm() was called; focus returns there (there is no trigger). */
  returnFocus: HTMLElement | null;
}

// Module-level queue: confirm() can be called from anywhere (event handlers,
// stores); the single ConfirmHost mounted in layout.tsx shows one at a time.
let queue: Request[] = [];
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getQueue = () => queue;
const EMPTY: Request[] = [];
const getServerQueue = () => EMPTY;

/**
 * Imperative replacement for `window.confirm`:
 * `if (!(await confirm({ title: "Session löschen?", confirmLabel: "Löschen", tone: "danger" }))) return;`
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (hosts === 0) {
    // No host mounted (should not happen): fall back to the native dialog
    // rather than leaving the caller hanging.
    const text = typeof opts.description === "string" ? `${opts.title}\n\n${opts.description}` : opts.title;
    return Promise.resolve(window.confirm(text));
  }
  const active = document.activeElement;
  const returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { id: nextId++, opts, resolve, returnFocus }];
    emit();
  });
}

function settle(id: number, ok: boolean) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  req.resolve(ok);
}

/** Mount once (layout.tsx). Shows queued confirm() requests one after another. */
export function ConfirmHost() {
  const current = React.useSyncExternalStore(subscribe, getQueue, getServerQueue)[0];
  // Keep the last request around while the dialog animates out.
  const [shown, setShown] = React.useState<Request | null>(null);
  if (current && current !== shown) setShown(current);

  React.useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (hosts === 0) {
        // Nobody can answer any more: reject what is pending.
        for (const r of queue) r.resolve(false);
        queue = [];
        emit();
      }
    };
  }, []);

  const req = current ?? shown;
  if (!req) return null;
  const { opts } = req;
  const open = Boolean(current);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && current) settle(current.id, false);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          // Radix would focus the (missing) trigger; return to where the user was.
          e.preventDefault();
          const target = req.returnFocus;
          setShown(null);
          if (target?.isConnected) target.focus({ preventScroll: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title}</AlertDialogTitle>
          {opts.description ? (
            <AlertDialogDescription>{opts.description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">{opts.title}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => current && settle(current.id, false)}>
            {opts.cancelLabel ?? "Abbrechen"}
          </AlertDialogCancel>
          <AlertDialogAction tone={opts.tone} onClick={() => current && settle(current.id, true)}>
            {opts.confirmLabel ?? "Bestätigen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
