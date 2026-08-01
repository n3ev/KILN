import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * Hand-built primitives over Radix — not a shadcn dump.
 *
 * Everything is styled from the CSS custom properties in tokens.css, so a token
 * change reaches the whole console at once and there is exactly one place to
 * argue about a colour.
 */

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  asChild?: boolean;
};

export function Button({ variant = "secondary", size = "md", asChild, className, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "k-btn inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap",
        "border transition-colors disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "k-btn-sm" : "k-btn-md",
        variant === "primary" && "k-btn-primary",
        variant === "secondary" && "k-btn-secondary",
        variant === "ghost" && "k-btn-ghost",
        variant === "danger" && "k-btn-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, children, ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section className={cn("k-panel", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <header className="k-panel-header">
      <div className="min-w-0">
        <h2 className="k-panel-title">{title}</h2>
        {meta ? <p className="k-panel-meta">{meta}</p> : null}
      </div>
      {action}
    </header>
  );
}

type Tone = "neutral" | "positive" | "warning" | "critical" | "accent" | "info";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("k-badge", `k-badge-${tone}`)}>{children}</span>;
}

/** A metric, its value, and — always — how stale the number is. */
export function Stat({
  label,
  value,
  delta,
  asOf,
}: {
  label: string;
  value: ReactNode;
  delta?: { value: number; polarity: "up" | "down" };
  asOf?: string;
}) {
  const good = delta ? (delta.polarity === "up" ? delta.value >= 0 : delta.value <= 0) : undefined;
  return (
    <div className="k-stat">
      <div className="k-stat-label">{label}</div>
      <div className="k-stat-value">{value}</div>
      <div className="k-stat-foot">
        {delta ? (
          <span className={good ? "k-delta-good" : "k-delta-bad"}>
            {delta.value >= 0 ? "+" : ""}
            {delta.value.toFixed(1)}%
          </span>
        ) : null}
        {asOf ? <span className="k-stat-asof">{asOf}</span> : null}
      </div>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="k-empty">
      <p className="k-empty-title">{title}</p>
      <p className="k-empty-body">{body}</p>
    </div>
  );
}

/** Honest degradation banner — never show stale numbers as current. */
export function StalenessBanner({ provider, lastSyncedIso }: { provider: string; lastSyncedIso?: string }) {
  return (
    <div className="k-banner k-banner-warning">
      <strong>{provider} is out of date.</strong>{" "}
      {lastSyncedIso ? `Last synced ${lastSyncedIso}.` : "No successful sync yet."} The numbers below are
      the most recent KILN has, not necessarily the most recent that exist.
    </div>
  );
}
