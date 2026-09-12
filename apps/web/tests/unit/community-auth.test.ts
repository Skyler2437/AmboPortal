import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: {userId:"cookie-user",role:"superadmin"} as {userId:string;role:string}|null,
  user: {role:"admin"} as {role:string}|null,
  profileError: null as object|null,
  getUser: vi.fn(), lookup:vi.fn(),
}));
vi.mock("@/lib/session",()=>({getSession:vi.fn(async()=>state.session)}));
vi.mock("@supabase/supabase-js",()=>({createClient:vi.fn(()=>({auth:{getUser:state.getUser}}))}));
vi.mock("@ambo/database/admin-client",()=>({createAdminClient:()=>({from:()=>({select:()=>({eq:(column:string,id:string)=>{state.lookup(column,id);return {maybeSingle:async()=>({data:state.user,error:state.profileError})};}})})})}));
import { communityActor } from "@/lib/community/server";
const request = (token?:string)=>new Request("http://localhost",{headers:token?{authorization:token}:{}});
beforeEach(()=>{vi.clearAllMocks();state.session={userId:"cookie-user",role:"superadmin"};state.user={role:"admin"};state.profileError=null;state.getUser.mockResolvedValue({data:{user:{id:"verified-bearer-user"}},error:null});});
describe("community authentication",()=>{
 it("accepts verified cookie identity but uses current database role",async()=>{const result=await communityActor(request(),true);expect(result.actor).toEqual({userId:"cookie-user",role:"admin"});});
 it("does not trust stale elevated cookie role",async()=>{state.user={role:"student"};expect((await communityActor(request(),true)).response?.status).toBe(403);});
 it("rejects an applicant even with valid cookie",async()=>{state.user={role:"applicant"};expect((await communityActor(request())).response?.status).toBe(403);});
 it("validates Bearer tokens against Auth and uses verified id",async()=>{const result=await communityActor(request("Bearer sample"));expect(state.getUser).toHaveBeenCalledWith("sample");expect(state.lookup).toHaveBeenCalledWith("id","verified-bearer-user");expect(result.actor?.userId).toBe("verified-bearer-user");});
 it("does not fall back to a cookie after invalid Bearer token",async()=>{state.getUser.mockResolvedValue({data:{user:null},error:{message:"invalid"}});expect((await communityActor(request("Bearer invalid"))).response?.status).toBe(401);expect(state.lookup).not.toHaveBeenCalled();});
 it("rejects malformed Authorization",async()=>{expect((await communityActor(request("Basic abc"))).response?.status).toBe(401);});
 it("rejects missing identity",async()=>{state.session=null;expect((await communityActor(request())).response?.status).toBe(401);});
 it("rejects deleted profile",async()=>{state.user=null;expect((await communityActor(request())).response?.status).toBe(403);});
 it("fails closed on profile lookup error",async()=>{state.profileError={message:"db unavailable"};expect((await communityActor(request())).response?.status).toBe(503);});
});
