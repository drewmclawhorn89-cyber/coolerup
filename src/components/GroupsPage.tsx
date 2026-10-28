import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ImagePlus, Lock, Plus, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  createGroup,
  joinGroup,
  listGroups,
  listMyGroups,
  timeAgo,
  type Group,
  type GroupPrivacy,
} from "@/lib/groups";

export type FeedTab = "home" | "following" | "foryou" | "marketplace" | "groups" | "live";

const TOP_TABS: { id: FeedTab; label: string; live?: boolean }[] = [
  { id: "home", label: "Home" },
  { id: "following", label: "Following" },
  { id: "foryou", label: "For You" },
  { id: "marketplace", label: "Marketplace" },
  { id: "groups", label: "Groups" },
  { id: "live", label: "LIVE", live: true },
];

export function GroupsTopTabs({
  feedTab,
  onPick,
}: {
  feedTab: FeedTab;
  onPick: (tab: FeedTab) => void;
}) {
  return (
    <div className="fixed left-1/2 top-6 z-50 flex w-full max-w-[430px] -translate-x-1/2 justify-center gap-3 overflow-x-auto bg-gradient-to-b from-black/80 to-transparent px-3 pb-2 pt-4 no-scrollbar">
      {TOP_TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className={`flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 pb-1 text-[13px] ${
            feedTab === t.id
              ? "border-white font-bold text-white"
              : "border-transparent text-white/60"
          }`}
        >
          {t.live && <span className="h-2 w-2 rounded-full bg-red-500" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function GroupCard({
  group,
  joined,
  onJoin,
  busy,
}: {
  group: Group;
  joined: boolean;
  onJoin: (group: Group) => void;
  busy: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#222]">
      {group.cover_image ? (
        <img src={group.cover_image} alt="" className="h-24 w-full object-cover" loading="lazy" />
      ) : (
        <div className="h-24 w-full bg-gradient-to-br from-zinc-700 to-zinc-900" />
      )}
      <div className="p-3">
        <div className="flex gap-3">
          {group.avatar_image ? (
            <img
              src={group.avatar_image}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-600 font-bold uppercase text-white">
              {group.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-white text-[15px]">{group.name}</p>
            <p className="flex items-center gap-1 text-[12px] text-gray-400">
              {group.privacy === "private" && <Lock className="h-3 w-3" />}
              {group.members_count} member{group.members_count === 1 ? "" : "s"} • {group.privacy}
            </p>
            {group.description && (
              <p className="mt-1 line-clamp-2 text-[12px] text-gray-300">{group.description}</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Link
            to="/groups/$groupId"
            params={{ groupId: group.id }}
            className="flex-1 rounded-full bg-white py-2 text-center text-[13px] font-bold text-black"
          >
            {joined ? "View Group" : "View"}
          </Link>
          {!joined && (
            <button
              onClick={() => onJoin(group)}
              disabled={busy}
              className="flex-1 rounded-full bg-[#3a3b3c] py-2 text-[13px] font-bold text-white disabled:opacity-60"
            >
              {busy ? "Joining…" : group.privacy === "private" ? "Request to join" : "Join"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function GroupsPage({
  feedTab = "groups",
  onPick,
}: {
  feedTab?: FeedTab;
  onPick?: (tab: FeedTab) => void;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"your" | "discover" | "create">("your");
  const [search, setSearch] = useState("");
  const [discover, setDiscover] = useState<Group[]>([]);
  const [mine, setMine] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const myIds = useMemo(() => new Set(mine.map((g) => g.id)), [mine]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [all, own] = await Promise.all([
        listGroups({ search }),
        auth.user ? listMyGroups(auth.user.id) : Promise.resolve([] as Group[]),
      ]);
      setDiscover(all);
      setMine(own);
    } catch (e: any) {
      const message = String(e?.message ?? "");
      // The tables ship in drizzle/migrations/0020_groups.sql — show a friendly
      // notice instead of a scary toast until that migration has been applied.
      if (message.includes("Could not find the table") || message.includes("PGRST205")) {
        setNeedsSetup(true);
      } else {
        toast.error(message || "Couldn't load groups");
      }
    } finally {
      setLoading(false);
    }
  }, [search, auth.user?.id]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(t);
  }, [refresh]);

  const pick = (t: FeedTab) => {
    if (onPick) {
      onPick(t);
      return;
    }
    void navigate({ to: "/", search: { feed: t } as any });
  };

  const handleJoin = async (group: Group) => {
    if (!auth.user || !auth.handle) {
      auth.signIn();
      return;
    }
    setBusyId(group.id);
    try {
      if (group.privacy === "private") {
        const { requestToJoin } = await import("@/lib/groups");
        await requestToJoin(group.id, auth.user.id, auth.handle);
        toast.success("Request sent — an admin will review it");
      } else {
        await joinGroup(group.id, auth.user.id, auth.handle);
        toast.success(`Joined ${group.name}`);
        void refresh();
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't join this group");
    } finally {
      setBusyId(null);
    }
  };

  const shown = tab === "your" ? mine : discover;
  const visible = shown.filter((g) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-black pb-24">
      <GroupsTopTabs feedTab={feedTab} onPick={pick} />

      <div className="mx-auto max-w-[430px] p-2 pt-24">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[20px] font-bold text-white">Groups</h1>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="flex items-center gap-1 rounded-full bg-white px-4 py-1 text-[13px] font-bold text-black"
          >
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>

        <label className="mb-3 flex w-full items-center gap-2 rounded-full bg-[#222] px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups"
            className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-gray-500"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search">
              <X className="h-4 w-4 text-gray-400" />
            </button>
          )}
        </label>

        <div className="mb-2 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {(
            [
              ["your", "Your Groups"],
              ["discover", "Discover"],
              ["create", "Create"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => (id === "create" ? setShowCreateGroup(true) : setTab(id))}
              className={`whitespace-nowrap rounded-full px-4 py-1 text-[13px] ${
                tab === id ? "bg-white font-bold text-black" : "bg-[#222] text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "your" && mine.length > 0 && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {mine.map((g) => (
              <Link
                key={g.id}
                to="/groups/$groupId"
                params={{ groupId: g.id }}
                className="flex w-20 shrink-0 flex-col items-center gap-1"
              >
                {g.avatar_image ? (
                  <img
                    src={g.avatar_image}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#222] font-bold uppercase text-white">
                    {g.name.charAt(0)}
                  </div>
                )}
                <span className="line-clamp-2 text-center text-[11px] text-gray-300">{g.name}</span>
              </Link>
            ))}
          </div>
        )}

        {needsSetup && (
          <div className="mb-3 rounded-xl border border-white/10 bg-[#222] p-3 text-[12px] text-gray-300">
            Groups is almost ready — the database tables still need to be created. Run
            <code className="mx-1 rounded bg-black px-1 py-0.5 text-[11px]">
              drizzle/migrations/0020_groups.sql
            </code>
            in Supabase to switch it on.
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-gray-400">Loading groups…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-xl bg-[#222] p-6 text-center">
            <Users className="mx-auto mb-2 h-8 w-8 text-gray-500" />
            <p className="text-sm font-bold text-white">
              {tab === "your" ? "You haven't joined any groups yet" : "No groups found"}
            </p>
            <p className="mt-1 text-[12px] text-gray-400">
              {tab === "your"
                ? "Discover a community or start your own."
                : "Try a different search, or create the first one."}
            </p>
            <button
              onClick={() => setShowCreateGroup(true)}
              className="mt-3 rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-black"
            >
              Create Group
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {visible.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                joined={myIds.has(g.id)}
                onJoin={handleJoin}
                busy={busyId === g.id}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateGroup && (
        <CreateGroupDialog
          onClose={() => setShowCreateGroup(false)}
          onCreated={(id) => {
            setShowCreateGroup(false);
            void navigate({ to: "/groups/$groupId", params: { groupId: id } });
          }}
        />
      )}
    </div>
  );
}

export function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<GroupPrivacy>("public");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!coverFile) return setCoverPreview("");
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => {
    if (!avatarFile) return setAvatarPreview("");
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const submit = async () => {
    if (!auth.user || !auth.handle) {
      auth.signIn();
      return;
    }
    if (!name.trim()) {
      toast.error("Give your group a name");
      return;
    }
    setSaving(true);
    try {
      const id = await createGroup({
        name,
        description,
        privacy,
        coverFile,
        avatarFile,
        userId: auth.user.id,
        username: auth.handle,
      });
      toast.success("Group created");
      onCreated(id);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't create the group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[90vh] w-full max-w-[400px] overflow-y-auto rounded-xl bg-[#222] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-white">Create Group</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <div className="relative mb-3">
          <button
            onClick={() => coverRef.current?.click()}
            className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-black text-gray-400"
          >
            {coverPreview ? (
              <img src={coverPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex items-center gap-2 text-[12px]">
                <ImagePlus className="h-4 w-4" /> Add cover image
              </span>
            )}
          </button>
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => avatarRef.current?.click()}
            className="absolute -bottom-4 left-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-[#222] bg-black text-gray-400"
            aria-label="Add group avatar"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </button>
          <input
            ref={avatarRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          maxLength={120}
          className="mb-2 w-full rounded-lg bg-black px-3 py-2 text-[14px] text-white outline-none placeholder:text-gray-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={3}
          className="mb-2 w-full resize-none rounded-lg bg-black px-3 py-2 text-[14px] text-white outline-none placeholder:text-gray-500"
        />
        <select
          value={privacy}
          onChange={(e) => setPrivacy(e.target.value as GroupPrivacy)}
          className="mb-3 w-full rounded-lg bg-black px-3 py-2 text-[14px] text-white outline-none"
        >
          <option value="public">Public — anyone can join</option>
          <option value="private">Private — admin approval</option>
        </select>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-gray-600 py-2 text-[13px] font-bold text-white"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 rounded-full bg-white py-2 text-[13px] font-bold text-black disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { timeAgo };
