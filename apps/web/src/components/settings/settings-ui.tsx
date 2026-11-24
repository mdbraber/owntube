"use client";

import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

/** A titled card on the settings page; `id` is its anchor in the section index. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 space-y-3"
    >
      <div className="px-1">
        <h2
          id={`${id}-title`}
          className="text-base font-semibold tracking-tight"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="ot-surface-card divide-y divide-[hsl(var(--border))] shadow-sm">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: its name and a short explanation on the left, the control on
 * the right (below it on narrow screens when `stack` is set).
 */
export function SettingRow({
  title,
  description,
  htmlFor,
  stack = false,
  disabled = false,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  /** Put the control under the text (lists, wide controls). */
  stack?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const Title = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex gap-x-6 gap-y-3 px-4 py-3.5 sm:px-5",
        stack ? "flex-col" : "items-center justify-between max-sm:flex-wrap",
        disabled && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <Title
          {...(htmlFor ? { htmlFor } : {})}
          className="block text-sm font-medium text-[hsl(var(--foreground))]"
        >
          {title}
        </Title>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className={cn(stack ? "w-full" : "shrink-0")}>{children}</div>
      ) : null}
    </div>
  );
}

/** A small body block inside a section card, for content that isn't one setting. */
export function SettingsBlock({ children }: { children: ReactNode }) {
  return <div className="space-y-3 px-4 py-4 text-sm sm:px-5">{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when no visible <label htmlFor> points at it. */
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** A switch row: the whole text is its label. */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingRow
      title={title}
      description={description}
      htmlFor={id}
      disabled={disabled}
    >
      <Toggle
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
    </SettingRow>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset className="inline-flex rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[calc(var(--radius-shell)_-_2px)] px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
              active
                ? "bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export const selectClassName =
  "h-9 max-w-full rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50";
