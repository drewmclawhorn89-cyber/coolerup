import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Globe, Lock, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  createGroup,
  fetchGroups,
  fetchMyMemberships,
  formatMembers,
  isActiveMember,
  joinGroup,
  uploadGroupImage,
  type Group,
  type GroupMember,
  type GroupPrivacy,
} from "@/lib/groups";

type GroupsTab = "your" | "discover" | "create";

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

export function GroupCard({
  group,
  role,
  onJoin,
  busy,
}: {
  group: Group;
  role?: GroupMember["role"] | null | undefined;
  onJoin: (group: Group) => void;
  busy?: boolean;
}) {
  const member = isActiveMember(role);
  const pending = role === "pending";

  return (
    <div className="overflow-hidden rounded-xl bg-[#222]">
      <img
        src={group.cover_image || FALLBACK_COVER}
        alt=""
        className="h-24 w-full object-cover"
        loading="lazy"
      />
      <div className="p-3">
        <div className="flex gap-3">
          <img
            src={group.avatar_image || FALLBACK_AVATAR}
            alt=""
            className="-mt-8 h-12 w-12 shrink-0 rounded-full border-2 border-[#222] object-cover"
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-white text-[15px]">{group.name}</p>
            <p className="flex items-center gap-1 text-[12px] text-gray-400">
              {group.privacy === "private" ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {formatMembers(group.members_count)} • {group.privacy === "private" ? "Private" : "Public"}
            </p>
            {group.description ? (
              <p className="mt-1 line-clamp-2 text-[13px] text-gray-300">{group.description}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {member ? (
            <Link
              to="/groups/$groupId"
              params={{ groupId: group.id }}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-white py-2 text-[13px] font-bold text-black"
            >
              <Check className="h-4 w-4" /> View Group
            </Link>
          ) : (
            <>
              <button
                onClick={() => onJoin(group)}
                disabled={busy || pending}
                className="flex-1 rounded-full bg-white py-2 text-[13px] font-bold text-black disabled:opacity-60"
              >
                {pending ? "Requested" : group.privacy === "private" ? "Request to Join" : "Join"}
              </button>
              <Link
                to="/groups/$groupId"
                params={{ groupId: group.id }}
                className="flex-1 rounded-full bg-[#3a3a3a] py-2 text-center text-[13px] font-bold text-white"
              >
                View
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateGroupForm({
  onCreated,
  onCancel,
}: {
  onCreated: (group: Group) => void;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<GroupPrivacy>("public");
  const [cover, setCover] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined, kind: "cover" | "avatar") => {
    if (!file || !auth.user) return;
    try {
      const url = await uploadGroupImage(file, auth.user.id, kind);
      if (kind === "cover") setCover(url);
      else setAvatar(url);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't upload that image.");
    }
  };

  const submit = async () => {
    if (!auth.user || !auth.handle) {
      toast.error("Sign in to create a group.");
      return;
    }
    if (!name.trim()) {
      toast.error("Give your group a name.");
      return;
    }
    setBusy(true);
    try {
      const group = await createGroup(
        { name, description, privacy, cover_image: cover, avatar_image: avatar },
        { id: auth.user.id, username: auth.handle },
      );
      toast.success("Group created");
      onCreated(group);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't create the group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-[#222] p-4">
      <h2 className="mb-3 font-bold text-white text-[18px]">Create Group</h2>

      <button
        onClick={() => coverInput.current?.click()}
        className="relative mb-3 block h-24 w-full overflow-hidden rounded-lg bg-black text-[12px] font-bold text-gray-400"
      >
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : "Add cover image"}
      </button>
      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0], "cover")}
      />

      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => avatarInput.current?.click()}
          className="h-14 w-14 overflow-hidden rounded-full bg-black text-[10px] font-bold text-gray-400"
        >
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : "Avatar"}
        </button>
        <span className="text-[12px] text-gray-400">Group avatar</span>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0], "avatar")}
        />
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name"
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
        <button onClick={onCancel} className="flex-1 rounded-full bg-gray-600 py-2 text-[14px] text-white">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-full bg-white py-2 text-[14px] font-bold text-black disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

export function GroupsPanel({ className = "" }: { className?: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [memberships, setMemberships] = useState<Record<string, GroupMember>>({});
  const [tab, setTab] = useState<GroupsTab>("discover");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchGroups();
      setGroups(list);
      if (auth.user) setMemberships(await fetchMyMemberships(auth.user.id));
      else setMemberships({});
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't load groups.");
      setGroups([]);
    }
  }, [auth.user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const yourGroups = useMemo(
    () => (groups ?? []).filter((g) => isActiveMember(memberships[g.id]?.role)),
    [groups, memberships],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = groups ?? [];
    if (!q) return base;
    return base.filter(
      (g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q),
    );
  }, [groups, query]);

  const discover = useMemo(() => filtered, [filtered]);
  const yourFiltered = useMemo(
    () => yourGroups.filter((g) => !query.trim() || g.name.toLowerCase().includes(query.trim().toLowerCase())),
    [yourGroups, query],
  );

  const handleJoin = async (group: Group) => {
    if (!auth.user || !auth.handle) {
      toast.error("Sign in to join groups.");
      return;
    }
    setBusyId(group.id);
    try {
      const role = await joinGroup(group, { id: auth.user.id, username: auth.handle });
      setMemberships((m) => ({
        ...m,
        [group.id]: {
          id: `${group.id}-${auth.user!.id}`,
          group_id: group.id,
          user_id: auth.user!.id,
          username: auth.handle!,
          role,
          joined_at: new Date().toISOString(),
        },
      }));
      setGroups((list) =>
        (list ?? []).map((g) =>
          g.id === group.id ? { ...g, members_count: (g.members_count ?? 0) + (role === "member" ? 1 : 0) } : g,
        ),
      );
      toast.success(role === "pending" ? "Request sent — an admin will review it." : `Joined ${group.name}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't join that group.");
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: GroupsTab; label: string }[] = [
    { id: "your", label: "Your Groups" },
    { id: "discover", label: "Discover" },
    { id: "create", label: "Create" },
  ];

  return (
    <div className={`min-h-full bg-[#0f0f0f] p-3 pb-24 text-white ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-bold text-[20px]">Groups</h1>
        <button
          onClick={() => {
            setTab("create");
            setShowCreate(true);
          }}
          className="flex items-center gap-1 rounded-full bg-white px-4 py-1 text-[13px] font-bold text-black"
        >
          <Plus className="h-4 w-4" /> Create
        </button>
      </div>

      <label className="mb-3 flex items-center gap-2 rounded-full bg-[#222] px-4 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search groups"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-gray-500"
        />
      </label>

      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setShowCreate(t.id === "create");
            }}
            className={`whitespace-nowrap rounded-full px-4 py-1 text-[13px] ${
              tab === t.id ? "bg-white font-bold text-black" : "bg-[#222] text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "your" && yourGroups.length > 0 && (
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
          {yourGroups.map((g) => (
            <Link
              key={g.id}
              to="/groups/$groupId"
              params={{ groupId: g.id }}
              className="w-24 shrink-0 text-center"
            >
              <img
                src={g.avatar_image || FALLBACK_AVATAR}
                alt=""
                className="mx-auto h-16 w-16 rounded-full object-cover"
              />
              <p className="mt-1 truncate text-[11px] text-gray-300">{g.name}</p>
            </Link>
          ))}
        </div>
      )}

      {groups === null && <p className="py-8 text-center text-[13px] text-gray-400">Loading groups…</p>}

      {groups !== null && tab === "discover" && (
        <div className="flex flex-col gap-3">
          {discover.length === 0 && (
            <div className="rounded-xl bg-[#222] p-6 text-center text-[13px] text-gray-400">
              No groups match “{query}”. Try creating one.
            </div>
          )}
          {discover.map((g) => (
            <GroupCard key={g.id} group={g} role={memberships[g.id]?.role} onJoin={handleJoin} busy={busyId === g.id} />
          ))}
        </div>
      )}

      {groups !== null && tab === "your" && (
        <div className="flex flex-col gap-3">
          {yourFiltered.length === 0 && (
            <div className="rounded-xl bg-[#222] p-6 text-center text-[13px] text-gray-400">
              <Users className="mx-auto mb-2 h-6 w-6" />
              You haven't joined any groups yet.{" "}
              <button onClick={() => setTab("discover")} className="font-bold text-white underline">
                Discover groups
              </button>
            </div>
          )}
          {yourFiltered.map((g) => (
            <GroupCard key={g.id} group={g} role={memberships[g.id]?.role} onJoin={handleJoin} busy={busyId === g.id} />
          ))}
        </div>
      )}

      {tab === "create" && (
        <CreateGroupForm
          onCancel={() => {
            setShowCreate(false);
            setTab("discover");
          }}
          onCreated={(group) => {
            setShowCreate(false);
            setTab("your");
            setGroups((list) => [group, ...(list ?? [])]);
            setMemberships((m) => ({
              ...m,
              [group.id]: {
                id: `${group.id}-${group.creator_id}`,
                group_id: group.id,
                user_id: group.creator_id,
                username: group.creator_username,
                role: "admin",
                joined_at: new Date().toISOString(),
              },
            }));
            void navigate({ to: "/groups/$groupId", params: { groupId: group.id } });
          }}
        />
      )}

      {showCreate && tab !== "create" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-[400px]">
            <CreateGroupForm
              onCancel={() => setShowCreate(false)}
              onCreated={(group) => {
                setShowCreate(false);
                setGroups((list) => [group, ...(list ?? [])]);
                void navigate({ to: "/groups/$groupId", params: { groupId: group.id } });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
