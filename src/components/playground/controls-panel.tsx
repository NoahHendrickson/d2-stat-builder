"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { ArgValue, Args, Control } from "@/components/playground/story";

/** "iconSize" → "Icon size": controls without a label read their arg name. */
function labelFor(name: string, control: Control): string {
  if (control.label) return control.label;
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The playground's knobs, built from the story's controls with the app's own inputs. */
export function ControlsPanel({
  args,
  controls,
  onChange,
}: {
  args: Args;
  controls: Partial<Record<string, Control>>;
  onChange: (name: string, value: ArgValue) => void;
}) {
  const entries = Object.entries(controls).filter(
    (entry): entry is [string, Control] => entry[1] != null,
  );
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to tweak here.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {entries.map(([name, control]) => (
        <ControlRow
          key={name}
          label={labelFor(name, control)}
          control={control}
          value={args[name]}
          onChange={(value) => onChange(name, value)}
        />
      ))}
    </div>
  );
}

function ControlRow({
  label,
  control,
  value,
  onChange,
}: {
  label: string;
  control: Control;
  value: ArgValue;
  onChange: (value: ArgValue) => void;
}) {
  const id = useId();

  if (control.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <Switch id={id} size="sm" checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  }

  if (control.type === "number") {
    const n = Number(value);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span id={id} className="text-sm">
            {label}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">{n}</span>
        </div>
        <Slider
          aria-labelledby={id}
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          value={n}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        />
      </div>
    );
  }

  if (control.type === "select") {
    return (
      <div className="flex flex-col gap-1.5">
        <span id={id} className="text-sm">
          {label}
        </span>
        <Select
          value={String(value)}
          onValueChange={(v) => v != null && onChange(v)}
        >
          <SelectTrigger className="w-full" aria-labelledby={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {control.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
