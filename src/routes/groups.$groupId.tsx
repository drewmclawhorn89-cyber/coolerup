import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  Globe,
  Heart,
  ImagePlus,
  Lock,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  approveMember,
  canModerate,
  createGroupPost,
  deleteGroupPost,
  fetchGroup,
  fetchGroupMembers,
  fetchGroupPosts,
  formatMembers,
  isActiveMember,
  isAdmin,
  joinGroup,
  leaveGroup,
  likeGroupPost,
  removeMember,
  setMemberRole,
  timeAgo,
  uploadGroupMedia,
  type Group,
  type GroupMember,
  type GroupPost,
} from "@/lib/groups";

export const Route = createFileRoute("/groups/$groupId")({
  head: () => ({ meta: [{ title: "Group — Coolerup" }] }),
  component: GroupPage,
});

type PageTab = "about" | "posts" | "members" | "settings";

const FALLBACK_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/></svg>`,
  );

const FALLBACK_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#3f3f46"/><circle cx="60" cy="46" r="20" fill="#a1a1aa"/><path d="M20 108c6-22 20-32 40-32s34 10 40 32z" fill="#a1a1aa"/></svg>`,
  );

function GroupPage() {
  const { groupId } = Route.useParams();
  const auth = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [tab, setTab] = useState<PageTab>("posts");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const myRole = useMemo(
    () => members.find((m) => m.user_id === auth.user?.id)?.role ?? null,
    [members, auth.user?.id],
  );
  const member = isActiveMember(myRole);
  const admin = isAdmin(myRole);
  const moderator = canModerate(myRole);

  const load = useCallback(async () => {
    try {
      const [g, m, p] = await Promise.all([
        fetchGroup(groupId),
        fetchGroupMembers(groupId),
        fetchGroupPosts(groupId),
      ]);
      setGroup(g);
      setMembers(m);
      setPosts(p);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't load this group.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleJoin = async () => {
    if (!group) return;
    if (!auth.user || !auth.handle) {
      toast.error("Sign in to join this group.");
      return;
    }
    setBusy(true);
    try {
      const role = await joinGroup(group, { id: auth.user.id, username: auth.handle });
      setMembers((list) => [
        ...list,
        {
          id: `${group.id}-${auth.user!.id}`,
          group_id: group.id,
          user_id: auth.user!.id,
          username: auth.handle!,
          role,
          joined_at: new Date().toISOString(),
        },
      ]);
      if (role === "member") setGroup({ ...group, members_count: (group.members_count ?? 0) + 1 });
      toast.success(role === "pending" ? "Request sent — an admin will review it." : `Joined ${group.name}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't join.");
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!group || !auth.user) return;
    setBusy(true);
    try {
      await leaveGroup(group.id, auth.user.id, myRole ?? undefined);
      setMembers((list) => list.filter((m) => m.user_id !== auth.user!.id));
      if (isActiveMember(myRole)) setGroup({ ...group, members_count: Math.max(0, (group.members_count ?? 1) - 1) });
      toast.success("Left group");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't leave.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-black text-gray-400">Loading group…</div>;
  }

  if (!group) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-black p-6 text-white">
        <p className="text-gray-400">This group doesn't exist (or was removed).</p>
        <Link to="/groups" className="rounded-full bg-white px-4 py-2 font-bold text-black">
          Browse groups
        </Link>
      </div>
    );
  }

  const tabs: PageTab[] = admin
    ? ["about", "posts", "members", "settings"]
    : ["about", "posts", "members"];

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-black pb-24 text-white">
      <div className="relative">
        <img src={group.cover_image || FALLBACK_COVER} alt="" className="h-40 w-full object-cover" />
        <button
          onClick={() => void navigate({ to: "/groups" })}
          aria-label="Back to groups"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="px-4">
        <img
          src={group.avatar_image || FALLBACK_AVATAR}
          alt=""
          className="-mt-10 h-20 w-20 rounded-full border-4 border-black object-cover"
        />
        <h1 className="mt-2 font-bold text-[20px]">{group.name}</h1>
        <p className="flex items-center gap-1 text-[12px] text-gray-400">
          {group.privacy === "private" ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
          {formatMembers(group.members_count)} • {group.privacy === "private" ? "Private group" : "Public group"}
        </p>

        <div className="mt-3 flex gap-2">
          {member ? (
            <button
              onClick={handleLeave}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-[#222] py-2 text-[13px] font-bold text-white disabled:opacity-60"
            >
              <Check className="h-4 w-4" /> Joined
            </button>
          ) : myRole === "pending" ? (
            <button
              onClick={handleLeave}
              disabled={busy}
              className="flex-1 rounded-full bg-[#222] py-2 text-[13px] font-bold text-gray-300 disabled:opacity-60"
            >
              Requested — tap to cancel
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-white py-2 text-[13px] font-bold text-black disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              {group.privacy === "private" ? "Request to Join" : "Join Group"}
            </button>
          )}
        </div>

        <div className="no-scrollbar mt-4 flex gap-4 overflow-x-auto border-b border-white/10 pb-2">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap pb-1 text-[13px] capitalize ${
                tab === t ? "border-b-2 border-white font-bold text-white" : "text-gray-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {tab === "about" && (
          <div className="rounded-xl bg-[#222] p-4">
            <h2 className="mb-1 font-bold text-[15px]">About</h2>
            <p className="text-[13px] text-gray-300">{group.description || "No description yet."}</p>
            <div className="mt-3 space-y-1 text-[12px] text-gray-400">
              <p>Created by @{group.creator_username}</p>
              <p>Created {new Date(group.created_at).toLocaleDateString()}</p>
              <p>{formatMembers(group.members_count)}</p>
            </div>
          </div>
        )}

        {tab === "posts" && (
          <PostsTab
            group={group}
            posts={posts}
            setPosts={setPosts}
            member={member}
            admin={moderator}
            onJoin={handleJoin}
          />
        )}

        {tab === "members" && (
          <MembersTab
            group={group}
            members={members}
            setMembers={setMembers}
            setGroup={setGroup}
            admin={admin}
            moderator={moderator}
            meId={auth.user?.id ?? null}
          />
        )}

        {tab === "settings" && admin && (
          <div className="rounded-xl bg-[#222] p-4">
            <h2 className="mb-2 font-bold text-[15px]">Settings</h2>
            <p className="text-[13px] text-gray-400">
              You're the admin of this group. Manage members and pending requests from the Members tab.
            </p>
            <div className="mt-3 space-y-2 text-[13px] text-gray-300">
              <p>Privacy: {group.privacy === "private" ? "Private (approval required)" : "Public"}</p>
              <p>Members: {group.members_count}</p>
              <p>Posts: {posts.length}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PostsTab({
  group,
  posts,
  setPosts,
  member,
  admin,
  onJoin,
}: {
  group: Group;
  posts: GroupPost[];
  setPosts: (fn: (p: GroupPost[]) => GroupPost[]) => void;
  member: boolean;
  admin: boolean;
  onJoin: () => void;
}) {
  const auth = useAuth();
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  const [posting, setPosting] = useState(false);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const attach = async (file: File | undefined) => {
    if (!file || !auth.user) return;
    try {
      setMedia(await uploadGroupMedia(file, auth.user.id));
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't upload that file.");
    }
  };

  const submit = async () => {
    if (!auth.user || !auth.handle) {
      toast.error("Sign in to post.");
      return;
    }
    setPosting(true);
    try {
      const post = await createGroupPost({
        groupId: group.id,
        userId: auth.user.id,
        username: auth.handle,
        caption,
        imageUrl: media?.kind === "image" ? media.url : null,
        videoUrl: media?.kind === "video" ? media.url : null,
      });
      setPosts((list) => [post, ...list]);
      setCaption("");
      setMedia(null);
      toast.success("Posted to group");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't post.");
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: GroupPost) => {
    const on = !liked.has(post.id);
    setLiked((s) => {
      const n = new Set(s);
      if (on) n.add(post.id);
      else n.delete(post.id);
      return n;
    });
    try {
      const likes = await likeGroupPost(post, on);
      setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, likes } : p)));
    } catch {
      /* optimistic only */
    }
  };

  const remove = async (post: GroupPost) => {
    try {
      await deleteGroupPost(post.id);
      setPosts((list) => list.filter((p) => p.id !== post.id));
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't delete that post.");
    }
  };

  return (
    <div className="space-y-3">
      {member ? (
        <div className="rounded-xl bg-[#222] p-3">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={`Write something in ${group.name}…`}
            rows={2}
            className="w-full resize-none bg-transparent text-[14px] text-white outline-none placeholder:text-gray-500"
          />
          {media && (
            <div className="relative mt-2 overflow-hidden rounded-lg">
              {media.kind === "image" ? (
                <img src={media.url} alt="" className="max-h-64 w-full object-cover" />
              ) : (
                <video src={media.url} controls playsInline className="max-h-64 w-full object-cover" />
              )}
              <button
                onClick={() => setMedia(null)}
                aria-label="Remove attachment"
                className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-full bg-black px-3 py-1.5 text-[12px] font-bold text-gray-300"
            >
              <ImagePlus className="h-4 w-4" /> Photo / Video
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => attach(e.target.files?.[0])}
            />
            <button
              onClick={submit}
              disabled={posting}
              className="rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-black disabled:opacity-60"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={onJoin} className="w-full rounded-xl bg-[#222] p-4 text-[13px] text-gray-300">
          Join this group to post, comment and react.
        </button>
      )}

      {posts.length === 0 && (
        <div className="rounded-xl bg-[#222] p-6 text-center text-[13px] text-gray-400">No posts yet.</div>
      )}

      {posts.map((post) => (
        <article key={post.id} className="overflow-hidden rounded-xl bg-[#222]">
          <div className="flex items-center gap-2 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black font-bold uppercase text-gray-300">
              {post.username?.[0] ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-white">@{post.username}</p>
              <p className="text-[11px] text-gray-400">{timeAgo(post.created_at)}</p>
            </div>
            {admin && (
              <button onClick={() => remove(post)} aria-label="Delete post" className="text-gray-500">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          {post.caption && <p className="px-3 pb-2 text-[14px] text-gray-200">{post.caption}</p>}
          {post.image_url && <img src={post.image_url} alt="" className="w-full object-cover" loading="lazy" />}
          {post.video_url && <video src={post.video_url} controls playsInline className="w-full" />}
          <div className="flex items-center gap-4 p-3">
            <button
              onClick={() => toggleLike(post)}
              className={`flex items-center gap-1 text-[12px] ${liked.has(post.id) ? "text-red-400" : "text-gray-400"}`}
            >
              <Heart className={`h-4 w-4 ${liked.has(post.id) ? "fill-current" : ""}`} /> {post.likes ?? 0}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function MembersTab({
  group,
  members,
  setMembers,
  setGroup,
  admin,
  moderator,
  meId,
}: {
  group: Group;
  members: GroupMember[];
  setMembers: (fn: (m: GroupMember[]) => GroupMember[]) => void;
  setGroup: (g: Group) => void;
  admin: boolean;
  moderator: boolean;
  meId: string | null;
}) {
  const pending = members.filter((m) => m.role === "pending");
  const banned = members.filter((m) => m.role === "banned");
  const active = members.filter((m) => m.role !== "pending" && m.role !== "banned");

  const approve = async (m: GroupMember) => {
    try {
      await approveMember(group.id, m.user_id);
      setMembers((list) => list.map((x) => (x.user_id === m.user_id ? { ...x, role: "member" } : x)));
      setGroup({ ...group, members_count: (group.members_count ?? 0) + 1 });
      toast.success(`Approved @${m.username}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't approve.");
    }
  };

  const makeModerator = async (m: GroupMember) => {
    try {
      await setMemberRole(group.id, m.user_id, "moderator");
      setMembers((list) => list.map((x) => (x.user_id === m.user_id ? { ...x, role: "moderator" } : x)));
      toast.success(`@${m.username} is now a moderator`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't update that member.");
    }
  };

  const remove = async (m: GroupMember, ban = false) => {
    try {
      await removeMember(group.id, m.user_id, { ban, role: m.role });
      if (ban) {
        setMembers((list) => list.map((x) => (x.user_id === m.user_id ? { ...x, role: "banned" } : x)));
      } else {
        setMembers((list) => list.filter((x) => x.user_id !== m.user_id));
        if (isActiveMember(m.role)) setGroup({ ...group, members_count: Math.max(0, (group.members_count ?? 1) - 1) });
      }
      toast.success(ban ? `Banned @${m.username}` : `Removed @${m.username}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't remove that member.");
    }
  };

  return (
    <div className="space-y-3">
      {admin && pending.length > 0 && (
        <div className="rounded-xl bg-[#222] p-3">
          <h3 className="mb-2 text-[13px] font-bold text-white">Join requests ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-[12px] font-bold uppercase text-gray-300">
                  {m.username?.[0] ?? "?"}
                </div>
                <p className="min-w-0 flex-1 truncate text-[13px] text-white">@{m.username}</p>
                <button
                  onClick={() => approve(m)}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black"
                >
                  Approve
                </button>
                <button
                  onClick={() => remove(m)}
                  aria-label="Decline request"
                  className="rounded-full bg-black p-1.5 text-gray-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-[#222] p-3">
        <h3 className="mb-2 text-[13px] font-bold text-white">Members ({active.length})</h3>
        <div className="space-y-2">
          {active.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-[12px] font-bold uppercase text-gray-300">
                {m.username?.[0] ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-white">
                  @{m.username}
                  {m.user_id === meId && <span className="text-gray-500"> (you)</span>}
                </p>
                <p className="text-[11px] capitalize text-gray-400">{m.role}</p>
              </div>
              {admin && m.user_id !== meId && (
                <div className="flex items-center gap-1">
                  {m.role === "member" && (
                    <button
                      onClick={() => makeModerator(m)}
                      aria-label="Make moderator"
                      title="Make moderator"
                      className="rounded-full bg-black p-1.5 text-gray-300"
                    >
                      <Shield className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => remove(m)}
                    aria-label="Remove member"
                    title="Remove"
                    className="rounded-full bg-black p-1.5 text-gray-300"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(m, true)}
                    aria-label="Ban member"
                    title="Ban"
                    className="rounded-full bg-black p-1.5 text-red-400"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {!admin && moderator && m.user_id !== meId && m.role === "member" && (
                <button
                  onClick={() => remove(m)}
                  aria-label="Remove member"
                  className="rounded-full bg-black p-1.5 text-gray-300"
                >
                  <UserMinus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {active.length === 0 && <p className="text-[13px] text-gray-400">No members yet.</p>}
        </div>
      </div>

      {admin && banned.length > 0 && (
        <div className="rounded-xl bg-[#222] p-3">
          <h3 className="mb-2 text-[13px] font-bold text-white">Banned ({banned.length})</h3>
          <div className="space-y-2">
            {banned.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] text-gray-400">@{m.username}</p>
                <button
                  onClick={() => approve(m)}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black"
                >
                  Unban
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
