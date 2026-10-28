import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Heart,
  ImagePlus,
  Lock,
  Settings,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  approveJoinRequest,
  cancelJoinRequest,
  createGroupPost,
  deleteGroup,
  deleteGroupPost,
  denyJoinRequest,
  getGroup,
  getMyJoinRequest,
  joinGroup,
  leaveGroup,
  likeGroupPost,
  listGroupPosts,
  listJoinRequests,
  listMembers,
  removeMember,
  requestToJoin,
  setMemberRole,
  timeAgo,
  updateGroup,
  type Group,
  type GroupJoinRequest,
  type GroupMember,
  type GroupPost,
  type GroupPrivacy,
  type GroupRole,
} from "@/lib/groups";

export const Route = createFileRoute("/groups_/$groupId")({
  head: () => ({
    meta: [
      { title: "Group — Coolerup" },
      { name: "description", content: "A community on Coolerup." },
    ],
  }),
  component: GroupPage,
});

type GroupTab = "about" | "posts" | "members" | "settings";

function GroupPage() {
  const { groupId } = Route.useParams();
  const auth = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [me, setMe] = useState<GroupMember | null>(null);
  const [request, setRequest] = useState<GroupJoinRequest | null>(null);
  const [requests, setRequests] = useState<GroupJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<GroupTab>("posts");

  const isAdmin = me?.role === "admin";
  const isStaff = me?.role === "admin" || me?.role === "moderator";
  const isMember = !!me;

  const refresh = useCallback(async () => {
    try {
      const g = await getGroup(groupId);
      if (!g) {
        setGroup(null);
        return;
      }
      setGroup(g);
      const [m, p] = await Promise.all([listMembers(groupId), listGroupPosts(groupId)]);
      setMembers(m);
      setPosts(p);
      if (auth.user) {
        const mine = m.find((x) => x.user_id === auth.user!.id) ?? null;
        setMe(mine);
        if (!mine) setRequest(await getMyJoinRequest(groupId, auth.user.id));
        else setRequest(null);
        if (mine && (mine.role === "admin" || mine.role === "moderator")) {
          setRequests(await listJoinRequests(groupId).catch(() => []));
        } else {
          setRequests([]);
        }
      } else {
        setMe(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load this group");
    } finally {
      setLoading(false);
    }
  }, [groupId, auth.user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const join = async () => {
    if (!auth.user || !auth.handle) {
      auth.signIn();
      return;
    }
    if (!group) return;
    setBusy(true);
    try {
      if (group.privacy === "private") {
        await requestToJoin(group.id, auth.user.id, auth.handle);
        toast.success("Request sent — an admin will review it");
      } else {
        await joinGroup(group.id, auth.user.id, auth.handle);
        toast.success(`Joined ${group.name}`);
      }
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't join this group");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!auth.user || !group) return;
    setBusy(true);
    try {
      await leaveGroup(group.id, auth.user.id);
      toast.success("You left the group");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't leave this group");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!auth.user || !group) return;
    setBusy(true);
    try {
      await cancelJoinRequest(group.id, auth.user.id);
      setRequest(null);
      toast.success("Request cancelled");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't cancel the request");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-sm text-gray-400">
        Loading group…
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center">
        <p className="text-white">This group doesn't exist or was removed.</p>
        <Link
          to="/groups"
          className="rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-black"
        >
          Browse groups
        </Link>
      </div>
    );
  }

  const tabs: GroupTab[] = isAdmin
    ? ["about", "posts", "members", "settings"]
    : ["about", "posts", "members"];

  return (
    <div className="min-h-screen bg-[#0f0f0f] pb-24">
      <div className="mx-auto max-w-[430px]">
        <div className="relative">
          {group.cover_image ? (
            <img src={group.cover_image} alt="" className="h-40 w-full object-cover" />
          ) : (
            <div className="h-40 w-full bg-gradient-to-br from-zinc-700 to-zinc-900" />
          )}
          <button
            onClick={() => navigate({ to: "/groups" })}
            aria-label="Back to groups"
            className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3">
          <div className="flex items-end justify-between">
            {group.avatar_image ? (
              <img
                src={group.avatar_image}
                alt=""
                className="-mt-10 h-20 w-20 rounded-full border-4 border-black object-cover"
              />
            ) : (
              <div className="-mt-10 flex h-20 w-20 items-center justify-center rounded-full border-4 border-black bg-[#222] text-2xl font-bold uppercase text-white">
                {group.name.charAt(0)}
              </div>
            )}
            <div className="mb-1">
              {isMember ? (
                isAdmin ? (
                  <span className="flex items-center gap-1 rounded-full bg-[#222] px-3 py-1.5 text-[12px] font-bold text-white">
                    <Check className="h-3.5 w-3.5" /> Admin
                  </span>
                ) : (
                  <button
                    onClick={leave}
                    disabled={busy}
                    className="rounded-full bg-[#3a3b3c] px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
                  >
                    Joined ✓
                  </button>
                )
              ) : request?.status === "pending" ? (
                <button
                  onClick={cancelRequest}
                  disabled={busy}
                  className="rounded-full bg-[#3a3b3c] px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
                >
                  Requested
                </button>
              ) : (
                <button
                  onClick={join}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-black disabled:opacity-60"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {group.privacy === "private" ? "Request to join" : "Join"}
                </button>
              )}
            </div>
          </div>

          <h1 className="mt-2 text-[20px] font-bold text-white">{group.name}</h1>
          <p className="flex items-center gap-1 text-[12px] text-gray-400">
            {group.privacy === "private" ? (
              <Lock className="h-3 w-3" />
            ) : (
              <Users className="h-3 w-3" />
            )}
            {group.privacy === "private" ? "Private group" : "Public group"} • {group.members_count}{" "}
            member
            {group.members_count === 1 ? "" : "s"}
          </p>

          <div className="mt-3 flex gap-1 overflow-x-auto border-b border-white/10 no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap px-3 pb-2 text-[13px] capitalize ${
                  tab === t ? "border-b-2 border-white font-bold text-white" : "text-white/60"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "about" && (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-[#222] p-3">
                <p className="text-[12px] font-bold uppercase tracking-wide text-gray-400">About</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-200">
                  {group.description || "No description yet."}
                </p>
              </div>
              <div className="rounded-xl bg-[#222] p-3 text-[13px] text-gray-300">
                <p>Created {new Date(group.created_at).toLocaleDateString()}</p>
                <p>Created by @{group.creator_username ?? "unknown"}</p>
                <p>Privacy: {group.privacy}</p>
              </div>
            </div>
          )}

          {tab === "posts" && (
            <div className="mt-3 space-y-3">
              {isMember ? (
                <Composer
                  groupId={group.id}
                  onPosted={async () => {
                    setPosts(await listGroupPosts(group.id));
                  }}
                />
              ) : (
                <div className="rounded-xl bg-[#222] p-3 text-center text-[12px] text-gray-400">
                  Join this group to post.
                </div>
              )}

              {posts.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-gray-400">No posts yet.</p>
              ) : (
                posts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    canDelete={isStaff || p.user_id === auth.user?.id}
                    onChanged={async () => setPosts(await listGroupPosts(group.id))}
                  />
                ))
              )}
            </div>
          )}

          {tab === "members" && (
            <div className="mt-3 space-y-3">
              {isStaff && requests.length > 0 && (
                <div className="rounded-xl bg-[#222] p-3">
                  <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-gray-400">
                    Join requests
                  </p>
                  {requests.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-1">
                      <span className="text-[13px] text-white">@{r.username ?? "member"}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            try {
                              await approveJoinRequest(r);
                              toast.success("Approved");
                              await refresh();
                            } catch (e: any) {
                              toast.error(e?.message || "Couldn't approve");
                            }
                          }}
                          className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black"
                        >
                          Approve
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await denyJoinRequest(r.id);
                              await refresh();
                            } catch (e: any) {
                              toast.error(e?.message || "Couldn't deny");
                            }
                          }}
                          className="rounded-full bg-[#3a3b3c] px-3 py-1 text-[11px] font-bold text-white"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl bg-[#222] p-3">
                {members.length === 0 ? (
                  <p className="text-[13px] text-gray-400">No members yet.</p>
                ) : (
                  members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 border-b border-white/5 py-2 last:border-0"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-600 text-[12px] font-bold uppercase text-white">
                        {(m.username ?? "?").charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-white">@{m.username ?? "member"}</p>
                        <p className="text-[11px] capitalize text-gray-400">{m.role}</p>
                      </div>
                      {isAdmin && m.user_id !== auth.user?.id && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => {
                              const next: GroupRole =
                                m.role === "moderator" ? "member" : "moderator";
                              try {
                                await setMemberRole(m.id, next);
                                await refresh();
                              } catch (e: any) {
                                toast.error(e?.message || "Couldn't update role");
                              }
                            }}
                            className="rounded-full bg-[#3a3b3c] px-2 py-1 text-[10px] font-bold text-white"
                          >
                            {m.role === "moderator" ? "Demote" : "Make mod"}
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await removeMember(m.id);
                                toast.success("Removed");
                                await refresh();
                              } catch (e: any) {
                                toast.error(e?.message || "Couldn't remove member");
                              }
                            }}
                            aria-label="Remove member"
                            className="rounded-full bg-[#3a3b3c] p-1.5 text-white"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "settings" && isAdmin && <SettingsTab group={group} onChanged={refresh} />}
        </div>
      </div>
    </div>
  );
}

function Composer({
  groupId,
  onPosted,
}: {
  groupId: string;
  onPosted: () => Promise<void> | void;
}) {
  const auth = useAuth();
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async () => {
    if (!auth.user || !auth.handle) {
      auth.signIn();
      return;
    }
    setPosting(true);
    try {
      await createGroupPost({
        groupId,
        userId: auth.user.id,
        username: auth.handle,
        caption,
        file,
      });
      setCaption("");
      setFile(null);
      await onPosted();
      toast.success("Posted to group");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't post");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="rounded-xl bg-[#222] p-3">
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Write something to the group…"
        rows={2}
        className="w-full resize-none bg-transparent text-[13px] text-white outline-none placeholder:text-gray-500"
      />
      {preview && (
        <div className="relative mb-2">
          {file?.type.startsWith("video/") ? (
            <video src={preview} className="max-h-64 w-full rounded-lg" controls />
          ) : (
            <img src={preview} alt="" className="max-h-64 w-full rounded-lg object-cover" />
          )}
          <button
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
            className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white"
          >
            Remove
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 text-[12px] font-bold text-gray-300"
        >
          <ImagePlus className="h-4 w-4" /> Photo / Video
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={submit}
          disabled={posting || (!caption.trim() && !file)}
          className="rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-black disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

function PostCard({
  post,
  canDelete,
  onChanged,
}: {
  post: GroupPost;
  canDelete: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [likes, setLikes] = useState(post.likes ?? 0);
  const [liked, setLiked] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl bg-[#222]">
      <div className="flex items-center gap-2 p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-600 text-[11px] font-bold uppercase text-white">
          {(post.username ?? "?").charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-white">@{post.username ?? "member"}</p>
          <p className="text-[11px] text-gray-400">{timeAgo(post.created_at)}</p>
        </div>
        {canDelete && (
          <button
            onClick={async () => {
              try {
                await deleteGroupPost(post.id);
                await onChanged();
              } catch (e: any) {
                toast.error(e?.message || "Couldn't delete post");
              }
            }}
            aria-label="Delete post"
            className="text-gray-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {post.caption && (
        <p className="whitespace-pre-wrap px-3 pb-2 text-[13px] text-gray-100">{post.caption}</p>
      )}
      {post.video_url && <video src={post.video_url} className="w-full" controls playsInline />}
      {post.image_url && (
        <img src={post.image_url} alt="" className="w-full object-cover" loading="lazy" />
      )}
      <button
        onClick={async () => {
          if (liked) return;
          setLiked(true);
          setLikes((n) => n + 1);
          try {
            await likeGroupPost({ ...post, likes });
          } catch {
            /* like is best-effort */
          }
        }}
        className={`flex items-center gap-1 px-3 py-2 text-[12px] ${liked ? "text-red-400" : "text-gray-300"}`}
      >
        <Heart className={`h-4 w-4 ${liked ? "fill-red-400" : ""}`} /> {likes}
      </button>
    </div>
  );
}

function SettingsTab({
  group,
  onChanged,
}: {
  group: Group;
  onChanged: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [privacy, setPrivacy] = useState<GroupPrivacy>(group.privacy);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateGroup(group.id, {
        name: name.trim() || group.name,
        description: description.trim() || null,
        privacy,
      });
      await onChanged();
      toast.success("Group updated");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl bg-[#222] p-3">
        <p className="mb-2 flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide text-gray-400">
          <Settings className="h-3.5 w-3.5" /> Group settings
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-2 w-full rounded-lg bg-black px-3 py-2 text-[13px] text-white outline-none"
          placeholder="Group name"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mb-2 w-full resize-none rounded-lg bg-black px-3 py-2 text-[13px] text-white outline-none"
          placeholder="Description"
        />
        <select
          value={privacy}
          onChange={(e) => setPrivacy(e.target.value as GroupPrivacy)}
          className="mb-3 w-full rounded-lg bg-black px-3 py-2 text-[13px] text-white outline-none"
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-full bg-white py-2 text-[13px] font-bold text-black disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="rounded-xl bg-[#222] p-3">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-red-400">
          Danger zone
        </p>
        <button
          onClick={async () => {
            if (!window.confirm("Delete this group for everyone?")) return;
            try {
              await deleteGroup(group.id);
              toast.success("Group deleted");
              void navigate({ to: "/groups" });
            } catch (e: any) {
              toast.error(e?.message || "Couldn't delete group");
            }
          }}
          className="w-full rounded-full bg-red-600 py-2 text-[13px] font-bold text-white"
        >
          Delete group
        </button>
      </div>
    </div>
  );
}
