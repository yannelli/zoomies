'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UpstreamTarget } from '@/server/domain/upstream';

const MAX_TARGETS = 64;
const MIN_TARGETS = 1;

interface TargetsEditorProps {
  targets: UpstreamTarget[];
  onChange: (next: UpstreamTarget[]) => void;
}

function parseIntegerInput(value: string): number {
  return Number.parseInt(value, 10) || 0;
}

export function TargetsEditor({ targets, onChange }: TargetsEditorProps) {
  const atMaxRows = targets.length >= MAX_TARGETS;
  const atMinRows = targets.length <= MIN_TARGETS;

  function updateRow(index: number, patch: Partial<UpstreamTarget>): void {
    const next = targets.map((target, i) => (i === index ? { ...target, ...patch } : target));
    onChange(next);
  }

  function addRow(): void {
    if (atMaxRows) return;
    onChange([...targets, { host: '', port: 80, weight: 1 }]);
  }

  function removeRow(index: number): void {
    if (atMinRows) return;
    onChange(targets.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Targets</Label>
        <span className="text-xs text-muted-foreground">
          {targets.length} / {MAX_TARGETS}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {targets.map((target, index) => {
          const hostId = `target-${index}-host`;
          const portId = `target-${index}-port`;
          const weightId = `target-${index}-weight`;
          return (
            <div
              key={index}
              className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2 rounded-lg border bg-background p-3"
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={hostId} className="text-xs text-muted-foreground">
                  Host
                </Label>
                <Input
                  id={hostId}
                  name={`target-${index}-host`}
                  type="text"
                  required
                  placeholder="backend.internal"
                  value={target.host}
                  onChange={(event) => updateRow(index, { host: event.target.value })}
                />
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor={portId} className="text-xs text-muted-foreground">
                  Port
                </Label>
                <Input
                  id={portId}
                  name={`target-${index}-port`}
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  required
                  value={target.port}
                  onChange={(event) =>
                    updateRow(index, { port: parseIntegerInput(event.target.value) })
                  }
                />
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor={weightId} className="text-xs text-muted-foreground">
                  Weight
                </Label>
                <Input
                  id={weightId}
                  name={`target-${index}-weight`}
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  required
                  value={target.weight}
                  onChange={(event) =>
                    updateRow(index, { weight: parseIntegerInput(event.target.value) })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(index)}
                disabled={atMinRows}
                aria-label={`Remove target ${index + 1}`}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                Remove
              </Button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={atMaxRows}>
          Add target
        </Button>
        {atMaxRows ? (
          <span className="text-xs text-muted-foreground">
            Maximum of {MAX_TARGETS} targets reached.
          </span>
        ) : null}
      </div>
    </div>
  );
}
