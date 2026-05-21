export type CliFlagValue = string | true | string[];

export interface ParsedCliArgs {
  positionals: string[];
  flags: Record<string, CliFlagValue>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, CliFlagValue> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      setFlag(flags, withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      setFlag(flags, withoutPrefix, next);
      index += 1;
    } else {
      setFlag(flags, withoutPrefix, true);
    }
  }

  return {
    positionals,
    flags
  };
}

export function readFlag(flags: Record<string, CliFlagValue>, name: string): string | undefined {
  const value = flags[name];
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return typeof value === "string" ? value : undefined;
}

export function readFlagValues(flags: Record<string, CliFlagValue>, name: string): string[] {
  const value = flags[name];
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}

export function readBooleanFlag(flags: Record<string, CliFlagValue>, name: string): boolean {
  return flags[name] === true;
}

function setFlag(flags: Record<string, CliFlagValue>, name: string, value: string | true): void {
  const existing = flags[name];
  if (existing === undefined) {
    flags[name] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(String(value));
    return;
  }
  flags[name] = [String(existing), String(value)];
}
