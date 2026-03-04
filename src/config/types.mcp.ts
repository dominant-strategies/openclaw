export type McpServerEntry = {
  url: string;
  transport?: "streamable-http";
  enabled?: boolean;
  headers?: Record<string, string>;
  toolPrefix?: string;
  oauth?: {
    accessToken?: string;
  };
};

export type McpServersConfig = Record<string, McpServerEntry>;
