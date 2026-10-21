import { z } from "zod";

import type { FetchFunction } from "../../shared/pristineFetch";
import {
  CONFIG_FILES_PATH,
  CONFIG_SAVE_PATH,
  CONFIG_SCHEMA_PATH,
  CONFIG_VALIDATE_PATH,
  UNREADABLE_ANSWER_MESSAGE,
} from "./constants";
import type {
  ConfigSaveResult,
  IConfigEditorClient,
  IConfigEditorSchema,
  IConfigFile,
  IConfigIssue,
  IConfigSchema,
} from "./types";

const configFileSchema: z.ZodType<IConfigFile> = z.object({
  content: z.string(),
  kind: z.enum(["manifest", "include", "config"]),
  path: z.string(),
  version: z.string(),
});
const configIssueSchema: z.ZodType<IConfigIssue> = z.object({
  column: z.number().int().positive().optional(),
  keyPath: z.string().optional(),
  line: z.number().int().positive().optional(),
  message: z.string(),
  path: z.string().optional(),
});
const configSchemaSchema: z.ZodType<IConfigSchema> = z.object({
  tables: z.record(z.string(), z.array(z.string())),
  values: z.record(z.string(), z.array(z.string())),
});
const editorSchemaSchema: z.ZodType<IConfigEditorSchema> = z.object({
  config: configSchemaSchema,
  manifest: configSchemaSchema,
});
const fileListSchema = z.object({ files: z.array(configFileSchema) });
const issuesSchema = z.object({ issues: z.array(configIssueSchema) });
const savedSchema = z.object({ version: z.string() });
const jsonRequestHeaders: Record<string, string> = { "content-type": "application/json" };

interface IRequestError {
  error: string;
}

interface IResponseAnswer {
  status: number;
  body: unknown;
  text: string;
}

type Answer = IResponseAnswer | IRequestError;

// Reads a successful answer's body, or returns undefined for a body of another shape.
type BodyReader<T> = (body: unknown) => T | undefined;

// What a request answered when it succeeded, or why it did not.
type RequestResult<T> = T | IRequestError;

/** Talks to the config editor routes of the control server. */
export function createConfigEditorClient(fetch: FetchFunction): IConfigEditorClient {
  const request = async (path: string, init: RequestInit): Promise<Answer> => {
    try {
      const response: Response = await fetch(path, init);
      const text: string = await response.text();

      return { body: readJSON(text), status: response.status, text };
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const post = (path: string, payload: object): Promise<Answer> => {
    return request(path, { body: JSON.stringify(payload), headers: jsonRequestHeaders, method: "POST" });
  };

  return {
    check: async (path, content) => {
      const answer: Answer = await post(CONFIG_VALIDATE_PATH, { path, content });

      return readOkAnswer(answer, (body: unknown) => issuesSchema.safeParse(body).data);
    },
    listFiles: async () => {
      const answer: Answer = await request(CONFIG_FILES_PATH, { cache: "no-store" });

      return readOkAnswer(answer, (body: unknown) => fileListSchema.safeParse(body).data);
    },
    readSchema: async () => {
      const answer: Answer = await request(CONFIG_SCHEMA_PATH, { cache: "no-store" });

      return readOkAnswer(answer, (body: unknown) => {
        const schema: IConfigEditorSchema | undefined = editorSchemaSchema.safeParse(body).data;

        return schema === undefined ? undefined : { schema };
      });
    },
    save: async (path, content, baseVersion) => {
      const answer: Answer = await post(CONFIG_SAVE_PATH, { path, content, baseVersion });

      return readSaveResult(answer);
    },
  };
}

function readSaveResult(answer: Answer): ConfigSaveResult {
  if ("error" in answer) {
    return { kind: "failed", message: answer.error };
  }

  if (answer.status === 409) {
    const file: IConfigFile | undefined = configFileSchema.safeParse(answer.body).data;

    return file === undefined ? { kind: "failed", message: UNREADABLE_ANSWER_MESSAGE } : { file, kind: "conflict" };
  }

  if (answer.status === 422) {
    const issues: IConfigIssue[] | undefined = issuesSchema.safeParse(answer.body).data?.issues;

    return issues === undefined ? { kind: "failed", message: UNREADABLE_ANSWER_MESSAGE } : { issues, kind: "refused" };
  }

  const saved = readOkAnswer(answer, (body: unknown) => savedSchema.safeParse(body).data);

  return "error" in saved ? { kind: "failed", message: saved.error } : { kind: "saved", version: saved.version };
}

function readOkAnswer<T>(answer: Answer, read: BodyReader<T>): RequestResult<T> {
  if ("error" in answer) {
    return answer;
  }

  if (answer.status < 200 || answer.status >= 300) {
    return { error: answer.text.trim() || `devhost answered ${answer.status}.` };
  }

  return read(answer.body) ?? { error: UNREADABLE_ANSWER_MESSAGE };
}

function readJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Errors arrive as plain text; their text is the message.
    return undefined;
  }
}
