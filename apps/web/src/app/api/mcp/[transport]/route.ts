import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { validateAccessToken } from "@/lib/mcp/oauth-store";
import { registerStudentTools } from "@/lib/mcp/tools/student-tools";
import { registerAdminTools } from "@/lib/mcp/tools/admin-tools";
import { getMcpResourceUrl } from "@/lib/mcp/oauth-utils";

// Allow long-running MCP requests on Vercel
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerStudentTools(server);
    registerAdminTools(server);
  },
  {
    serverInfo: {
      name: "Ambassador Portal",
      version: "1.0.0",
    },
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
  }
);

async function verifyToken(_req: Request, bearerToken?: string) {
  if (!bearerToken) return undefined;

  const tokenData = await validateAccessToken(bearerToken, getMcpResourceUrl());
  if (!tokenData) return undefined;

  return {
    token: bearerToken,
    clientId: tokenData.clientId,
    scopes: tokenData.scope.split(" ").filter(Boolean),
    extra: {
      userId: tokenData.userId,
      role: tokenData.role,
    },
  };
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
