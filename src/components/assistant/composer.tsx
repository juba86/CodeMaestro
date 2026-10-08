"use client";

import * as React from "react";
import { ArrowUp, BookOpen, FileUp, Paperclip, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useBottomChrome } from "@/components/ui/toaster";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsMobile } from "@/hooks/use-media-query";
import { composerPlaceholder, formatBytes, sendBlockedReason, type ComposerMode } from "./composer-logic";
import { ModeMenu, type ModeMenuProps } from "./mode-menu";

interface Attachment {
  id: string;
  name: string;
  size: number;
  progress: number;
  state: "uploading" | "done" | "error";
  /** Saved name in the project folder, or the error reason. */
  detail?: string;
  xhr?: XMLHttpRequest;
}

/**
 * Uploads files into the session's project folder (existing upload API,
 * multipart), with per-file progress for the attachment chips.
 */
function useUploads(sessionId: string | null, onSaved: (names: string[]) => void) {
  const [items, setItems] = React.useState<Attachment[]>([]);
  const savedRef = React.useRef(onSaved);
  React.useEffect(() => {
    savedRef.current = onSaved;
  }, [onSaved]);

  // Chips belong to one session.
  React.useEffect(() => {
    setItems([]);
  }, [sessionId]);

  const patch = (id: string, p: Partial<Attachment>) => setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));

  const upload = React.useCallback(
    (files: FileList | null) => {
      if (!files || !files.length || !sessionId) return;
      for (const file of Array.from(files)) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const xhr = new XMLHttpRequest();
        const fd = new FormData();
        fd.append("files", file);
        setItems((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0, state: "uploading", xhr }]);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) patch(id, { progress: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () => {
          let d: { saved?: unknown; error?: unknown } = {};
          try {
            d = JSON.parse(xhr.responseText || "{}");
          } catch {
            /* not JSON */
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            patch(id, { state: "error", detail: typeof d.error === "string" ? d.error : "Upload fehlgeschlagen.", xhr: undefined });
            return;
          }
          const saved = Array.isArray(d.saved) ? d.saved.filter((n): n is string => typeof n === "string") : [];
          if (!saved.length) {
            patch(id, { state: "error", detail: "Datei wurde übersprungen (Name nicht erlaubt).", xhr: undefined });
            return;
          }
          patch(id, { state: "done", progress: 100, detail: saved.join(", "), xhr: undefined });
          savedRef.current(saved);
        };
        xhr.onerror = () => patch(id, { state: "error", detail: "Server nicht erreichbar.", xhr: undefined });
        xhr.onabort = () => setItems((prev) => prev.filter((a) => a.id !== id));
        xhr.open("POST", `/api/assistant/sessions/${encodeURIComponent(sessionId)}/upload`);
        xhr.send(fd);
      }
    },
    [sessionId],
  );

  const remove = (id: string) => {
    const a = items.find((x) => x.id === id);
    if (a?.xhr) a.xhr.abort();
    else setItems((prev) => prev.filter((x) => x.id !== id));
  };
  const clearDone = React.useCallback(() => setItems((prev) => prev.filter((a) => a.state === "uploading")), []);
  return { items, upload, remove, clearDone, uploading: items.some((a) => a.state === "uploading") };
}

export interface ComposerProps extends Omit<ModeMenuProps, "disabled"> {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  useKnowledge: boolean;
  onUseKnowledge: (v: boolean) => void;
  sessionId: string | null;
  running: boolean;
  /** A synchronous step (hybrid planning) is in flight. */
  busy: boolean;
  offline: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/** The composer (DESIGN.md §6.2.5). */
export function Composer(props: ComposerProps) {
  const { value, onChange, onSend, useKnowledge, onUseKnowledge, sessionId, running, busy, offline, mode } = props;
  const isMobile = useIsMobile();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const ownRef = React.useRef<HTMLTextAreaElement | null>(null);
  const taRef = props.textareaRef ?? ownRef;
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  useBottomChrome(rootRef, isMobile);

  const onSaved = React.useCallback(
    (names: string[]) => {
      if (!value.trim()) onChange(`Ich habe folgende Dateien ins Projekt hochgeladen: ${names.join(", ")}. `);
    },
    [value, onChange],
  );
  const uploads = useUploads(sessionId, onSaved);

  const blocked = sendBlockedReason({ text: value, running, offline, busy, hasSession: !!sessionId });
  const send = () => {
    if (blocked) return;
    onSend();
    uploads.clearDone();
  };

  useHotkeys(
    {
      "mod+enter": (e) => {
        const t = e.target as HTMLElement | null;
        // From the composer, or from anywhere outside other text fields.
        if (t && t !== taRef.current && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
        send();
      },
    },
    { allowInInputs: ["mod+enter"] },
  );

  const mode_ = mode as ComposerMode;
  return (
    <div ref={rootRef} className="shrink-0 bg-background px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] md:px-6 md:pb-4">
      <div
        className={cn(
          "mx-auto w-full max-w-[760px] rounded-xl border border-border-strong bg-card shadow-sm transition-colors focus-within:border-ring",
          offline && "opacity-70",
        )}
      >
        {uploads.items.length ? (
          <ul className="flex flex-wrap gap-1.5 px-2.5 pt-2.5" aria-label="Anhänge">
            {uploads.items.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border pl-2 pr-0.5 text-xs md:h-7",
                  a.state === "error" ? "border-danger-border bg-danger-subtle text-danger" : "border-border bg-surface-2 text-foreground",
                )}
                title={a.detail}
              >
                {a.state === "uploading" ? <Spinner className="size-3.5" aria-label="wird hochgeladen" /> : <FileUp aria-hidden className="size-3.5 shrink-0" />}
                <span className="min-w-0 truncate font-medium">{a.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {a.state === "uploading" ? `${a.progress} %` : a.state === "error" ? a.detail : formatBytes(a.size)}
                </span>
                <IconButton
                  aria-label={a.state === "uploading" ? `Upload von ${a.name} abbrechen` : `${a.name} aus der Liste entfernen`}
                  size="icon-sm"
                  className="size-8 md:size-6"
                  onClick={() => uploads.remove(a.id)}
                >
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        <Textarea
          ref={taRef}
          aria-label="Nachricht"
          autosize={{ min: 1, max: 8 }}
          value={value}
          disabled={offline}
          placeholder={composerPlaceholder({ mode: mode_, running, offline })}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line (as before the redesign).
            // On touch keyboards Enter stays a line break; the button sends.
            if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
            if (e.metaKey || e.ctrlKey) return; // handled by the mod+enter hotkey
            if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
            e.preventDefault();
            send();
          }}
          className="border-0 bg-transparent px-3 pt-2.5 text-base/6 shadow-none focus-visible:outline-none md:text-sm"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <ModeMenu {...props} disabled={running || busy} />
          <ToggleChip pressed={useKnowledge} onPressedChange={onUseKnowledge} variant="default" aria-label="Wissensbasis nutzen" className="h-10 md:h-7">
            <BookOpen aria-hidden />
            Wissen
          </ToggleChip>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { uploads.upload(e.target.files); e.target.value = ""; }} />
          <IconButton
            aria-label="Datei anhängen"
            size="icon"
            disabledReason={!sessionId ? "Erst eine Session wählen." : offline ? "Offline" : undefined}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip />
          </IconButton>
          <span className="flex-1" />
          <span className="hidden items-center gap-1 text-xs text-subtle-foreground md:inline-flex" aria-hidden>
            <Kbd>↵</Kbd>
            senden ·
            <Kbd>⇧</Kbd>
            <Kbd>↵</Kbd>
            neue Zeile
          </span>
          <Button
            variant="primary"
            size="icon"
            aria-label="Senden"
            disabledReason={blocked ?? undefined}
            onClick={send}
            className="md:size-8"
          >
            {busy ? <Spinner /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}
