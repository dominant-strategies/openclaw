import { buildPluginConfigSchema, type OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { z } from "openclaw/plugin-sdk/zod";

export type EntropicIntegrationsPluginConfig = {
  gwsCommand?: string;
};

export type ResolvedEntropicIntegrationsPluginConfig = {
  gwsCommand: string;
};

const DEFAULT_GWS_COMMAND = "gws";

const nonEmptyTrimmedString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const EntropicIntegrationsPluginConfigSchema = z.strictObject({
  gwsCommand: nonEmptyTrimmedString("gwsCommand must be a non-empty string").optional(),
});

function formatConfigIssue(issue: z.ZodIssue | undefined): string {
  if (!issue) {
    return "invalid config";
  }
  if (issue.code === "unrecognized_keys" && issue.keys.length > 0) {
    return `unknown config key: ${issue.keys[0]}`;
  }
  if (issue.code === "invalid_type" && issue.path.length === 0) {
    return "expected config object";
  }
  return issue.message;
}

export function createEntropicIntegrationsPluginConfigSchema(): OpenClawPluginConfigSchema {
  return buildPluginConfigSchema(EntropicIntegrationsPluginConfigSchema, {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      const parsed = EntropicIntegrationsPluginConfigSchema.safeParse(value);
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }
      return {
        success: false,
        error: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.filter((segment): segment is string | number => {
              const kind = typeof segment;
              return kind === "string" || kind === "number";
            }),
            message: formatConfigIssue(issue),
          })),
        },
      };
    },
  });
}

export function resolveEntropicIntegrationsPluginConfig(
  value: unknown,
): ResolvedEntropicIntegrationsPluginConfig {
  if (value === undefined) {
    return { gwsCommand: DEFAULT_GWS_COMMAND };
  }

  const parsed = EntropicIntegrationsPluginConfigSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatConfigIssue(parsed.error.issues[0]);
    throw new Error(`Invalid entropic-integrations plugin config: ${message}`);
  }

  return {
    gwsCommand: parsed.data.gwsCommand ?? DEFAULT_GWS_COMMAND,
  };
}
