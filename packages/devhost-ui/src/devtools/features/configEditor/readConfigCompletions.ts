import type { ConfigCompletionKind, IConfigCompletions, IConfigSchema, TomlCursorContext } from "./types";

const elementIndexPattern = /^(.*)\[\d+\]$/;

interface ISchemaMatch {
  keys: string[];
  /** How many path segments the schema path matches through `*`. */
  wildcards: number;
}

/** Lists what the schema accepts where the cursor is: tables in a header, keys in a table, or a setting's values. */
export function readConfigCompletions(schema: IConfigSchema, context: TomlCursorContext): IConfigCompletions | null {
  if (context.kind === "none") {
    return null;
  }

  if (context.kind === "value") {
    const values: string[] | undefined = findSchemaEntry(schema.values, context.keyPath);

    if (values === undefined) {
      return null;
    }

    return {
      from: context.from,
      options: values.map((value: string) => ({
        apply: context.isQuoted ? value : JSON.stringify(value),
        kind: "value",
        label: value,
      })),
    };
  }

  const tablePath: string[] =
    context.kind === "key" ? [...context.tablePath, ...context.parentPath] : context.parentPath;
  const keys: string[] | undefined = findSchemaEntry(schema.tables, tablePath);

  if (keys === undefined) {
    return null;
  }

  const options = keys.flatMap((key: string) => {
    const kind: ConfigCompletionKind = isSchemaTable(schema, [...tablePath, key]) ? "table" : "key";

    return context.kind === "header" && kind !== "table" ? [] : [{ apply: key, kind, label: key }];
  });

  return { from: context.from, options };
}

function isSchemaTable(schema: IConfigSchema, path: string[]): boolean {
  return (
    findSchemaEntry(schema.tables, path) !== undefined || findSchemaEntry(schema.tables, [...path, "*"]) !== undefined
  );
}

/**
 * Finds the entry for a document path among entries keyed by schema paths, in which `*` stands for any name. An
 * element of an array of tables, such as `actions[1]`, is the array's `*`. A path the schema names exactly wins over
 * one it matches through `*`.
 */
function findSchemaEntry(entries: Record<string, string[]>, path: string[]): string[] | undefined {
  const segments: string[] = path.flatMap((segment: string): string[] => {
    const arrayName: string | undefined = elementIndexPattern.exec(segment)?.[1];

    return arrayName === undefined ? [segment] : [arrayName, "*"];
  });
  let bestMatch: ISchemaMatch | undefined;

  for (const [schemaPath, keys] of Object.entries(entries)) {
    const schemaSegments: string[] = schemaPath === "" ? [] : schemaPath.split(".");

    if (
      schemaSegments.length !== segments.length ||
      !schemaSegments.every((schemaSegment: string, index: number) => {
        return schemaSegment === "*" || schemaSegment === segments[index];
      })
    ) {
      continue;
    }

    const wildcards: number = schemaSegments.filter((schemaSegment: string): boolean => schemaSegment === "*").length;

    if (bestMatch === undefined || wildcards < bestMatch.wildcards) {
      bestMatch = { keys, wildcards };
    }
  }

  return bestMatch?.keys;
}
