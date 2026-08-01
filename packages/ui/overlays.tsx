"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "./primitives.js";

export function Dialog({ trigger, title, description, children }: { trigger: ReactNode; title: string; description?: string; children: ReactNode }) {
  return <DialogPrimitive.Root><DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger><DialogPrimitive.Portal><DialogPrimitive.Overlay className="k-dialog-overlay" /><DialogPrimitive.Content className="k-dialog"><DialogPrimitive.Title>{title}</DialogPrimitive.Title>{description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}<div className="k-dialog-body">{children}</div><DialogPrimitive.Close asChild><Button size="sm">Close</Button></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}

export function Sheet({ trigger, title, children }: { trigger: ReactNode; title: string; children: ReactNode }) {
  return <DialogPrimitive.Root><DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger><DialogPrimitive.Portal><DialogPrimitive.Overlay className="k-dialog-overlay" /><DialogPrimitive.Content className="k-sheet"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><div className="k-dialog-body">{children}</div><DialogPrimitive.Close asChild><Button size="sm">Done</Button></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}

export function Tabs({ items, defaultValue }: { items: Array<{ id: string; label: string; content: ReactNode }>; defaultValue?: string }) {
  const initial = defaultValue ?? items[0]?.id ?? "";
  return <TabsPrimitive.Root className="k-tabs" defaultValue={initial}><TabsPrimitive.List>{items.map((item) => <TabsPrimitive.Trigger key={item.id} value={item.id}>{item.label}</TabsPrimitive.Trigger>)}</TabsPrimitive.List>{items.map((item) => <TabsPrimitive.Content key={item.id} value={item.id}>{item.content}</TabsPrimitive.Content>)}</TabsPrimitive.Root>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="k-tooltip" sideOffset={6}>{label}<TooltipPrimitive.Arrow /></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}

export function Toast({ title, body, tone = "neutral" }: { title: string; body?: string; tone?: "neutral" | "positive" | "warning" | "critical" }) {
  return <div className="k-toast" data-tone={tone} role="status"><strong>{title}</strong>{body ? <span>{body}</span> : null}</div>;
}

export function Command({ items }: { items: Array<{ id: string; label: string; hint?: string }> }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [items, query]);
  return <div className="k-command"><input className="k-control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a command" aria-label="Filter commands" /><div role="listbox">{matches.map((item) => <button type="button" role="option" key={item.id}><span>{item.label}</span>{item.hint ? <small>{item.hint}</small> : null}</button>)}</div></div>;
}
