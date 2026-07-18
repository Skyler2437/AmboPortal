import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/mcp/oauth-utils";

export async function GET() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(
    {
      resource: `${baseUrl}/api/mcp/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["read", "write"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
