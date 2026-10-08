"use client";

import { useId } from "react";
import Link from "next/link";
import { BookOpen, Folder, Hammer, LayoutTemplate, Network, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { newSessionHref, recentFolders, type HomeSession } from "./home-logic";
import { Widget } from "./widget";

const TILE =
  "flex h-16 flex-col items-start justify-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-xs " +
  "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-5";

function Tile({ href, icon: Icon, label, primary }: { href: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Link href={href} className={cn(TILE, primary && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}>
      <Icon aria-hidden className={primary ? undefined : "text-primary-text"} />
      {label}
    </Link>
  );
}

function FolderChips({ sessions }: { sessions: HomeSession[] | null }) {
  const labelId = useId();
  if (!sessions) {
    return (
      <div className="flex gap-1.5" aria-hidden>
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    );
  }
  const folders = recentFolders(sessions, 3);
  if (folders.length === 0) return null;
  return (
    <div>
      <p id={labelId} className="mb-1.5 text-xs text-muted-foreground">
        Neue Session in …
      </p>
      <ul aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {folders.map((f) => (
          <li key={f.path} className="min-w-0 max-w-full">
            <Link
              href={newSessionHref(f.path)}
              title={f.path}
              aria-label={`Neue Session in ${f.label}`}
              className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-3 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-7 md:px-2"
            >
              <Folder aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{f.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** „Schnellstart": phone = 2×2 tiles, desktop = a list of actions; plus recent project folders. */
export function QuickStart({ sessions, className }: { sessions: HomeSession[] | null; className?: string }) {
  return (
    <Widget title="Schnellstart" className={className}>
      <div className="grid grid-cols-2 gap-2 md:hidden">
        <Tile href={newSessionHref()} icon={Plus} label="Neue Session" primary />
        <Tile href="/builder" icon={Hammer} label="Prompt bauen" />
        <Tile href="/orchestra" icon={Network} label="Orchester" />
        <Tile href="/knowledge" icon={BookOpen} label="Wissensbasis" />
      </div>
      <Card className="hidden flex-col gap-3 p-3 md:flex">
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href={newSessionHref()}>
            <Plus />
            Neue Session
          </Link>
        </Button>
        <FolderChips sessions={sessions} />
        <div className="flex flex-col gap-0.5 border-t border-border pt-2">
          {[
            { href: "/builder", icon: Hammer, label: "Prompt bauen" },
            { href: "/templates", icon: LayoutTemplate, label: "Vorlage verwenden" },
            { href: "/orchestra", icon: Network, label: "Orchester bearbeiten" },
          ].map(({ href, icon: Icon, label }) => (
            <Button key={href} asChild variant="ghost" className="justify-start text-foreground">
              <Link href={href}>
                <Icon className="text-muted-foreground" />
                {label}
              </Link>
            </Button>
          ))}
        </div>
      </Card>
      <div className="mt-3 md:hidden">
        <FolderChips sessions={sessions} />
      </div>
    </Widget>
  );
}
