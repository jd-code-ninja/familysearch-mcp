import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const CONFIG_PATH = path.join(os.homedir(), ".familysearch-mcp", "session.json");
const FAMILYSEARCH_URL = "https://www.familysearch.org";

interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
}

interface SessionData {
  cookies: StoredCookie[];
  timestamp: number | string;
}

async function loadSession(): Promise<SessionData | null> {
  try {
    const data = await fs.promises.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveSession(cookies: StoredCookie[]): Promise<void> {
  const session: SessionData = {
    cookies,
    timestamp: new Date().toISOString(),
  };
  await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(session, null, 2));
}

function getSessionId(cookies: StoredCookie[]): string | null {
  const c = cookies.find(c => c.name === "fssessionid");
  return c ? c.value : null;
}

function getSessionAgeHours(timestamp: number | string): number {
  const ts = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  return (Date.now() - ts) / (1000 * 60 * 60);
}

async function fetchWithCookies(url: string, cookies: StoredCookie[]): Promise<{ status: number; body: string }> {
  const cookieString = cookies
    .filter(c => !c.expires || new Date(c.expires) > new Date())
    .map(c => `${c.name}=${c.value}`)
    .join("; ");

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/x-rt-json, application/json",
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
        } else {
          resolve({ status: res.statusCode || 200, body: data });
        }
      });
    });
    request.on("error", reject);
  });
}

async function extractBrowserCookies(): Promise<StoredCookie[]> {
  const scriptPath = path.join(path.dirname(CONFIG_PATH), "get_cookies.py");
  try {
    const output = execFileSync("python3", [scriptPath], { encoding: "utf-8", timeout: 10000 });
    const parsed = JSON.parse(output);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed as StoredCookie[];
  } catch (e: any) {
    throw new Error(`Failed to extract cookies from browser: ${e.message}`);
  }
}

async function authenticate(): Promise<StoredCookie[]> {
  console.error("Extracting FamilySearch cookies from your browser...");
  const cookies = await extractBrowserCookies();
  console.error("Session found! Saving...");
  await saveSession(cookies);
  return cookies;
}

async function getCookies(): Promise<StoredCookie[]> {
  let session = await loadSession();

  if (!session) {
    console.error("No session found. Extracting cookies from browser...");
    return await authenticate();
  }

  const ageHours = getSessionAgeHours(session.timestamp);
  if (ageHours > 24) {
    console.error("Session expired (24+ hours). Re-extracting cookies from browser...");
    return await authenticate();
  }

  return session.cookies;
}

async function apiGet(endpoint: string, cookies: StoredCookie[]): Promise<any> {
  const sessionId = getSessionId(cookies);
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `https://www.familysearch.org/platform${endpoint}${separator}sessionId=${sessionId}`;
  const { body } = await fetchWithCookies(url, cookies);
  return JSON.parse(body);
}

const server = new Server(
  {
    name: "familysearch-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "say-hello",
        description: "A simple greeting function to test the connection",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "authenticate",
        description: "Extract FamilySearch session from browser cookies",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-current-user",
        description: "Get information about the currently logged in user",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search-persons",
        description: "Search for persons in the FamilySearch Family Tree",
        inputSchema: {
          type: "object",
          properties: {
            givenName: { type: "string", description: "First name" },
            familyName: { type: "string", description: "Last name" },
            birthPlace: { type: "string", description: "Birth place" },
            limit: { type: "number", description: "Max results (default 10)", default: 10 },
          },
        },
      },
      {
        name: "get-person",
        description: "Get details about a specific person by their ID",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-ancestors",
        description: "Get ancestors of a person (up to 8 generations)",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
            generations: { type: "number", description: "Number of generations (default 3)", default: 3 },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-descendants",
        description: "Get descendants of a person (up to 3 generations)",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
            generations: { type: "number", description: "Number of generations (default 2)", default: 2 },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-children",
        description: "Get the children of a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-parents",
        description: "Get the parents of a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-spouses",
        description: "Get the spouses of a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-families",
        description: "Get the families (as child and as parent) for a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-change-history",
        description: "Get the change history for a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-notes",
        description: "Get all notes attached to a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-sources",
        description: "Get all source references for a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-memories",
        description: "Get memories attached to a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-portrait",
        description: "Get the portrait URL for a person",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-person-matches",
        description: "Get matches for a Family Tree person (record hints)",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The person ID" },
          },
          required: ["personId"],
        },
      },
      {
        name: "get-current-tree-person",
        description: "Get the tree person that represents the current user",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-relationship-finder",
        description: "Find how two persons are related",
        inputSchema: {
          type: "object",
          properties: {
            personId: { type: "string", description: "The first person ID" },
            relativeId: { type: "string", description: "The second person ID" },
          },
          required: ["personId", "relativeId"],
        },
      },
      {
        name: "get-couple-relationship",
        description: "Get a couple relationship by its ID",
        inputSchema: {
          type: "object",
          properties: {
            relationshipId: { type: "string", description: "The relationship ID" },
          },
          required: ["relationshipId"],
        },
      },
      {
        name: "get-child-relationship",
        description: "Get a child-and-parents relationship by its ID",
        inputSchema: {
          type: "object",
          properties: {
            relationshipId: { type: "string", description: "The relationship ID" },
          },
          required: ["relationshipId"],
        },
      },
      {
        name: "search-places",
        description: "Search for places in the FamilySearch place authority",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Place name to search for" },
            parentId: { type: "string", description: "Parent place ID to narrow search" },
            limit: { type: "number", description: "Max results (default 10)", default: 10 },
          },
          required: ["name"],
        },
      },
      {
        name: "get-place",
        description: "Get details about a specific place by its ID",
        inputSchema: {
          type: "object",
          properties: {
            placeId: { type: "string", description: "The place ID" },
          },
          required: ["placeId"],
        },
      },
      {
        name: "get-place-description",
        description: "Get the description of a place",
        inputSchema: {
          type: "object",
          properties: {
            placeId: { type: "string", description: "The place ID" },
          },
          required: ["placeId"],
        },
      },
      {
        name: "get-place-description-children",
        description: "Get the child places of a place description",
        inputSchema: {
          type: "object",
          properties: {
            placeId: { type: "string", description: "The place ID" },
          },
          required: ["placeId"],
        },
      },
      {
        name: "get-source-description",
        description: "Get a source description by its ID",
        inputSchema: {
          type: "object",
          properties: {
            sourceId: { type: "string", description: "The source description ID" },
          },
          required: ["sourceId"],
        },
      },
      {
        name: "get-source-folders",
        description: "Get all source folders for the current user",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-user-memories",
        description: "Get memories belonging to the current user",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results (default 20)", default: 20 },
          },
        },
      },
      {
        name: "get-collections",
        description: "Get all collections available in the FamilySearch API",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-home",
        description: "Get the home resource describing the FamilySearch API",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-pending-modifications",
        description: "Get the set of pending modifications for the FamilySearch API",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get-agent",
        description: "Get information about an agent (user or contributor) by their ID",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "The agent/user ID" },
          },
          required: ["agentId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === "say-hello") {
      return {
        content: [{ type: "text", text: "Hello from FamilySearch MCP! Session loads automatically from browser cookies." }],
      };
    }

    if (name === "authenticate") {
      const cookies = await authenticate();
      return {
        content: [{ type: "text", text: "Successfully authenticated! Session saved." }],
      };
    }

    const cookies = await getCookies();
    const a = (args as Record<string, any>) || {};

    switch (name) {
      case "get-current-user": {
        const data = await apiGet("/users/current", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "search-persons": {
        const params = new URLSearchParams();
        if (a.givenName) params.append("givenName", String(a.givenName));
        if (a.familyName) params.append("familyName", String(a.familyName));
        if (a.birthPlace) params.append("birthPlace", String(a.birthPlace));
        params.append("limit", String(a.limit || 10));
        const data = await apiGet(`/tree/search?${params.toString()}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person": {
        const data = await apiGet(`/tree/persons/${a.personId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-ancestors": {
        const gens = a.generations || 3;
        const data = await apiGet(`/tree/ancestry?person=${a.personId}&generations=${gens}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-descendants": {
        const gens = a.generations || 2;
        const data = await apiGet(`/tree/descendancy?person=${a.personId}&generations=${gens}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-children": {
        const data = await apiGet(`/tree/persons/${a.personId}/children`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-parents": {
        const data = await apiGet(`/tree/persons/${a.personId}/parents`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-spouses": {
        const data = await apiGet(`/tree/persons/${a.personId}/spouses`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-families": {
        const data = await apiGet(`/tree/persons/${a.personId}/families`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-change-history": {
        const data = await apiGet(`/tree/persons/${a.personId}/change-history`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-notes": {
        const data = await apiGet(`/tree/persons/${a.personId}/notes`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-sources": {
        const data = await apiGet(`/tree/persons/${a.personId}/source-references`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-memories": {
        const data = await apiGet(`/tree/persons/${a.personId}/memories`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-portrait": {
        const data = await apiGet(`/tree/persons/${a.personId}/portrait`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-person-matches": {
        const data = await apiGet(`/tree/persons/${a.personId}/matches`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-current-tree-person": {
        const data = await apiGet("/tree/current-person", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-relationship-finder": {
        const data = await apiGet(`/tree/relationship-finder?person=${a.personId}&spouse=${a.relativeId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-couple-relationship": {
        const data = await apiGet(`/tree/couple-relationships/${a.relationshipId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-child-relationship": {
        const data = await apiGet(`/tree/child-and-parents-relationships/${a.relationshipId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "search-places": {
        const params = new URLSearchParams();
        params.append("name", String(a.name));
        if (a.parentId) params.append("parentId", String(a.parentId));
        params.append("limit", String(a.limit || 10));
        const data = await apiGet(`/places/search?${params.toString()}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-place": {
        const data = await apiGet(`/places/${a.placeId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-place-description": {
        const data = await apiGet(`/places/${a.placeId}/description`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-place-description-children": {
        const data = await apiGet(`/places/${a.placeId}/description/children`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-source-description": {
        const data = await apiGet(`/sources/descriptions/${a.sourceId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-source-folders": {
        const data = await apiGet("/source-folders", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-user-memories": {
        const data = await apiGet(`/users/memories?limit=${a.limit || 20}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-collections": {
        const data = await apiGet("/collections", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-home": {
        const data = await apiGet("/home", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-pending-modifications": {
        const data = await apiGet("/pending-modifications", cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      case "get-agent": {
        const data = await apiGet(`/users/${a.agentId}`, cookies);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
