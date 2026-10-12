"use client";

import { useEffect, useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteOrchestraProfile, errorMessage, fetchOrchestraProfiles, postOrchestraProfile, type OrchestraProfile } from "./api";
import { useOrchestraPage } from "./context";

const NAME_MAX = 60;

/**
 * The user's own saved charts: save the current draft under a name, load one
 * back into the editor (like a preset, it applies once saved) or delete it.
 */
export function ProfilesMenu() {
  const { editor, readOnly } = useOrchestraPage();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<OrchestraProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // Load the list the first time the menu opens (and again after an error).
  const needed = open && profiles === null && error === null;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    fetchOrchestraProfiles()
      .then((list) => { if (!cancelled) setProfiles(list); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err, "Profile konnten nicht geladen werden.")); });
    return () => { cancelled = true; };
  }, [needed]);

  const draft = editor.draft;
  const clean = name.trim();
  const replaces = profiles?.find((p) => p.name.toLowerCase() === clean.toLowerCase()) ?? null;

  async function save() {
    if (!draft || !clean) return;
    if (replaces && !(await confirm({ title: `Profil ‚${replaces.name}‘ überschreiben?`, description: "Es wird durch die aktuelle Besetzung ersetzt.", confirmLabel: "Überschreiben" }))) return;
    setSaving(true);
    try {
      setProfiles(await postOrchestraProfile(clean, draft));
      setName("");
      toast.success(`Profil gespeichert: ${clean}`);
    } catch (err) {
      toast.error(errorMessage(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: OrchestraProfile) {
    if (!(await confirm({ title: `Profil ‚${p.name}‘ löschen?`, description: "Die aktuelle Besetzung bleibt, wie sie ist.", confirmLabel: "Löschen", tone: "danger" }))) return;
    try {
      setProfiles(await deleteOrchestraProfile(p.id));
    } catch (err) {
      toast.error(errorMessage(err, "Profil konnte nicht gelöscht werden."));
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && error) setError(null); // retry
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={!editor.ready}>
          <Bookmark aria-hidden className="size-3.5" /> Profile
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Orchester-Profile" className="w-[min(22rem,calc(100vw-1rem))] space-y-3 p-3">
        <div aria-live="polite">
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {profiles && profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine Profile. Speichere die aktuelle Besetzung unter einem Namen.</p>
          ) : null}
        </div>
        {!profiles && !error ? <Skeleton className="h-10 w-full" /> : null}
        {profiles?.length ? (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 min-w-0 flex-1 justify-start px-2 md:h-7"
                  disabled={readOnly}
                  title={`Profil ‚${p.name}‘ laden`}
                  onClick={() => {
                    setOpen(false);
                    void editor.loadProfile(p.name, p.config);
                  }}
                >
                  <span className="truncate">{p.name}</span>
                </Button>
                <IconButton aria-label={`Profil ‚${p.name}‘ löschen`} onClick={() => void remove(p)}>
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            aria-label="Name des Profils"
            placeholder="Aktuelle Besetzung speichern als …"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="sm" loading={saving} disabled={!clean || !draft}>
            {replaces ? "Ersetzen" : "Speichern"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
