type MCPTransport = "stdio" | "streamable_http" | "sse";

type MCPClientDraft = {
  name?: string;
  description?: string;
  enabled?: boolean;
  isActive?: boolean;
  transport?: unknown;
  type?: unknown;
  url?: unknown;
  baseUrl?: unknown;
  headers?: Record<string, string>;
  command?: unknown;
  args?: unknown;
  env?: Record<string, string>;
  cwd?: unknown;
};

export type MCPClientPayload = {
  name: string;
  description: string;
  enabled: boolean;
  transport: MCPTransport;
  url: string;
  headers: Record<string, string>;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClientLike(rawData: unknown): rawData is MCPClientDraft {
  if (!isObject(rawData)) {
    return false;
  }

  return Boolean(
    rawData.command ||
      rawData.url ||
      rawData.baseUrl ||
      rawData.transport ||
      rawData.type,
  );
}

export function normalizeTransport(raw?: unknown): MCPTransport | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  switch (value) {
    case "stdio":
      return "stdio";
    case "sse":
      return "sse";
    case "streamablehttp":
    case "streamable_http":
    case "streamable-http":
    case "http":
      return "streamable_http";
    default:
      return undefined;
  }
}

export function normalizeClientData(
  key: string,
  rawData: MCPClientDraft,
): MCPClientPayload {
  const transport =
    normalizeTransport(rawData.transport ?? rawData.type) ??
    (rawData.url || rawData.baseUrl || !rawData.command
      ? "streamable_http"
      : "stdio");

  const command =
    transport === "stdio" ? (rawData.command ?? "").toString() : "";

  return {
    name: rawData.name || key,
    description: rawData.description || "",
    enabled: rawData.enabled ?? rawData.isActive ?? true,
    transport,
    url: (rawData.url || rawData.baseUrl || "").toString(),
    headers: rawData.headers || {},
    command,
    args: Array.isArray(rawData.args) ? rawData.args.map(String) : [],
    env: rawData.env || {},
    cwd: (rawData.cwd || "").toString(),
  };
}

export function parseCreateClientsJson(input: string): Array<{
  key: string;
  data: MCPClientPayload;
}> {
  const parsed = JSON.parse(input) as Record<string, unknown>;
  const clientsToCreate: Array<{ key: string; data: MCPClientPayload }> = [];

  if (isObject(parsed.mcpServers)) {
    Object.entries(parsed.mcpServers).forEach(([key, data]) => {
      if (isClientLike(data)) {
        clientsToCreate.push({
          key,
          data: normalizeClientData(key, data),
        });
      }
    });
  } else if (typeof parsed.key === "string" && isClientLike(parsed)) {
    const directKey = String((parsed as Record<string, unknown>).key);
    clientsToCreate.push({
      key: directKey,
      data: normalizeClientData(directKey, parsed),
    });
  } else {
    Object.entries(parsed).forEach(([key, data]) => {
      if (isClientLike(data)) {
        clientsToCreate.push({
          key,
          data: normalizeClientData(key, data),
        });
      }
    });
  }

  if (clientsToCreate.length === 0) {
    throw new Error(
      "No valid MCP clients found. Use { \"mcpServers\": { \"key\": {...} } } or a single client object.",
    );
  }

  return clientsToCreate;
}

export function parseUpdateClientJson(
  input: string,
  currentKey: string,
): MCPClientPayload {
  const parsed = JSON.parse(input) as Record<string, unknown>;

  if (isObject(parsed.mcpServers)) {
    const wrappedClient = parsed.mcpServers[currentKey];
    if (isClientLike(wrappedClient)) {
      return normalizeClientData(currentKey, wrappedClient);
    }

    const entries = Object.entries(parsed.mcpServers).filter(([, value]) =>
      isClientLike(value),
    );
    if (entries.length === 1) {
      const [wrappedKey, wrappedData] = entries[0];
      if (wrappedKey !== currentKey) {
        throw new Error(
          `This editor cannot rename MCP client keys. Expected \"${currentKey}\" but found \"${wrappedKey}\".`,
        );
      }
      if (isClientLike(wrappedData)) {
        return normalizeClientData(currentKey, wrappedData);
      }
    }
  }

  if (typeof parsed.key === "string") {
    if (parsed.key !== currentKey) {
      throw new Error(
        `This editor cannot rename MCP client keys. Expected \"${currentKey}\" but found \"${parsed.key}\".`,
      );
    }
    if (isClientLike(parsed)) {
      return normalizeClientData(currentKey, parsed);
    }
  }

  if (isClientLike(parsed)) {
    return normalizeClientData(currentKey, parsed);
  }

  throw new Error(
    "Invalid MCP client JSON. Provide a single client object or { \"mcpServers\": { currentKey: {...} } }.",
  );
}