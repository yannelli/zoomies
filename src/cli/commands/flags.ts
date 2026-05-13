/**
 * Tiny argv-flag parser shared by command modules.
 *
 * Supports `--name value`, `--name=value`, and repeated flags (returned as
 * `string[]`). Positionals — anything not consumed by a known flag — are
 * returned in `positional` in the order they appeared.
 *
 * Boolean flags (`--yes`, `--help`) live in `flags` but their value is the
 * literal string `'true'` so callers don't have to worry about a tri-state
 * `boolean | string`.
 */

export interface ParsedFlags {
  flags: Record<string, string>;
  repeated: Record<string, string[]>;
  positional: string[];
}

export interface FlagSpec {
  /** Flags that always take a value (`--hostname X` or `--hostname=X`). */
  valueFlags: ReadonlySet<string>;
  /** Flags that can be repeated; values accumulate into `repeated[name]`. */
  repeatedFlags?: ReadonlySet<string>;
  /** Flags that are pure booleans (no value). */
  boolFlags?: ReadonlySet<string>;
}

export class FlagParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlagParseError';
  }
}

export function parseFlags(args: readonly string[], spec: FlagSpec): ParsedFlags {
  const flags: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  const positional: string[] = [];
  const boolFlags = spec.boolFlags ?? new Set<string>();
  const repeatedFlags = spec.repeatedFlags ?? new Set<string>();

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      i += 1;
      continue;
    }

    let name: string;
    let value: string | undefined;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      name = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      name = arg.slice(2);
      value = undefined;
    }

    if (boolFlags.has(name)) {
      if (value !== undefined) {
        throw new FlagParseError(`flag --${name} does not take a value`);
      }
      flags[name] = 'true';
      i += 1;
      continue;
    }

    if (repeatedFlags.has(name)) {
      const consumed = value;
      if (consumed === undefined) {
        const next = args[i + 1];
        if (next === undefined) {
          throw new FlagParseError(`flag --${name} requires a value`);
        }
        if (!Array.isArray(repeated[name])) {
          repeated[name] = [];
        }
        repeated[name]!.push(next);
        i += 2;
      } else {
        if (!Array.isArray(repeated[name])) {
          repeated[name] = [];
        }
        repeated[name]!.push(consumed);
        i += 1;
      }
      continue;
    }

    if (spec.valueFlags.has(name)) {
      if (value !== undefined) {
        flags[name] = value;
        i += 1;
        continue;
      }
      const next = args[i + 1];
      if (next === undefined) {
        throw new FlagParseError(`flag --${name} requires a value`);
      }
      flags[name] = next;
      i += 2;
      continue;
    }

    // Unknown flag — surface to the caller. (Help is the only convention
    // every command shares; let the command itself decide whether to bail
    // or to allow stragglers.)
    if (value !== undefined) {
      flags[name] = value;
    } else {
      flags[name] = 'true';
    }
    i += 1;
  }

  return { flags, repeated, positional };
}
