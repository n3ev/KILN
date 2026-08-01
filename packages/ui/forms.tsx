import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn.js";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("k-field", className)}>
      <label className="k-field-label" htmlFor={htmlFor}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? <span className="k-field-error" role="alert">{error}</span> : hint ? <span className="k-field-hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={cn("k-control", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea className={cn("k-control", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentPropsWithoutRef<"select">) {
  return <select className={cn("k-control", className)} {...props}>{children}</select>;
}
