import { beforeEach, describe, expect, it, vi } from "vitest";
import { communityPostSchema } from "@/lib/community/validation";

const state = vi.hoisted(() => ({
  actor: { userId: "00000000-0000-4000-8000-000000000001", role: "admin" },
  response: null as Response | null,
  rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/community/server", async (original) => {
  const actual = await original<typeof import("@/lib/community/server")>();
  return { ...actual, communityActor: vi.fn(async () => ({ actor: state.actor, db: { rpc: state.rpc, from: state.from }, response: state.response })), mutationLimit: vi.fn(async () => null) };
});
import { POST } from "@/app/api/community/posts/route";
import { GET as getPoll, POST as vote } from "@/app/api/community/posts/[id]/poll/route";
import { PATCH, DELETE } from "@/app/api/community/posts/scheduled/[id]/route";
import { communityActor } from "@/lib/community/server";
const id = "00000000-0000-4000-8000-000000000002";
const future = () => new Date(Date.now() + 3600000).toISOString();
function request(body: unknown, method = "POST") { return new Request("http://localhost/api/community/posts", { method, body: typeof body === "string" ? body : JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); state.actor.role = "admin"; state.response = null; state.rpc.mockResolvedValue({ data: { id, scheduled: false }, error: null }); });

describe("community validation", () => {
  it("accepts scheduled polls and trims options", () => {
    const result = communityPostSchema.parse({ content: " Question ", publish_at: future(), poll: { options: [" Yes ", " No "], closes_at: new Date(Date.now()+7200000).toISOString() } });
    expect(result.content).toBe("Question"); expect(result.poll?.options).toEqual(["Yes", "No"]);
  });
  it.each([
    { content: "" }, { content: "x", publish_at: "not-a-date" },
    { content: "x", publish_at: "2020-01-01T00:00:00Z" },
    { content: "x", poll: { options: ["one"] } },
    { content: "x", poll: { options: ["Yes", " yes "] } },
    { content: "x", poll: { options: ["", "two"] } },
    { content: "x", poll: { options: ["1","2","3","4","5","6","7"] } },
    { content: "x", user_id: "attacker" },
    { content: "x", poll: { options: ["one", "two"], closes_at: "2020-01-01T00:00:00Z" } },
  ])("rejects invalid post %#", body => { expect(communityPostSchema.safeParse(body).success).toBe(false); });
  it("rejects closing before scheduled publication", () => {
    expect(communityPostSchema.safeParse({ content:"Q",publish_at:future(),poll:{options:["A","B"],closes_at:new Date(Date.now()+1000).toISOString()} }).success).toBe(false);
  });
});

describe("community API", () => {
  it("requires admin authority and uses verified actor identity", async () => {
    const response = await POST(request({ content: "Question", poll: { options: ["A", "B"] } }));
    expect(response.status).toBe(201); expect(communityActor).toHaveBeenCalledWith(expect.any(Request), true);
    expect(state.rpc).toHaveBeenCalledWith("create_community_post", { p_user_id: state.actor.userId, p_content: "Question", p_publish_at: null, p_poll: { options:["A","B"],closes_at:null } });
  });
  it("does not write on denied access", async () => {
    state.response = new Response("Forbidden",{status:403});
    expect((await POST(request({content:"x"}))).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized bodies", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(JSON.stringify({content:"x".repeat(31000)})))).status).toBe(413);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not report a save without a returned id", async () => {
    state.rpc.mockResolvedValue({ data:null,error:null }); expect((await POST(request({content:"x"}))).status).toBe(500);
  });
  it("maps closed poll to actionable conflict", async () => {
    state.rpc.mockResolvedValue({error:{code:"22023"},data:null});
    expect((await vote(request({option_id:id}),{params:{id}})).status).toBe(409);
  });
  it("returns only aggregate RPC response after a confirmed vote", async () => {
    const poll = { options:[{id,label:"Yes",votes:1}],total_votes:1,my_option_id:id,closed:false };
    state.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:poll,error:null});
    const response=await vote(request({option_id:id}),{params:{id}});
    expect(await response.json()).toEqual({poll});
    expect(state.rpc).toHaveBeenNthCalledWith(1,"cast_post_poll_vote",{p_post_id:id,p_user_id:state.actor.userId,p_option_id:id});
  });
  it("does not cache voter-specific poll state", async () => {
    const response=await getPoll(new Request("http://localhost"),{params:{id}});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["PATCH","DELETE"])("%s filters owner and reports publication race", async method => {
    const query={eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn(async()=>({data:null,error:null}))};
    query.eq.mockReturnValue(query);query.select.mockReturnValue(query);
    state.from.mockReturnValue({ update:vi.fn(()=>query),delete:vi.fn(()=>query) });
    const response=method==="PATCH" ? await PATCH(request({content:"x",publish_at:future()},"PATCH"),{params:{id}}) : await DELETE(new Request("http://localhost",{method:"DELETE"}),{params:{id}});
    expect(query.eq).toHaveBeenCalledWith("user_id",state.actor.userId);expect(response.status).toBe(404);
  });
});
