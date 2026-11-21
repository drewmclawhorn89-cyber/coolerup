import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type QueryResult<T = unknown> = {
  data: T;
  error: null;
  count?: number | null;
};

function createQueryBuilder(isSingle = false) {
  const result = (): QueryResult => ({
    data: isSingle ? null : [],
    error: null,
    count: isSingle ? null : 0,
  });

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    like: () => builder,
    ilike: () => builder,
    is: () => builder,
    in: () => builder,
    contains: () => builder,
    containedBy: () => builder,
    rangeGt: () => builder,
    rangeGte: () => builder,
    rangeLt: () => builder,
    rangeLte: () => builder,
    rangeAdjacent: () => builder,
    overlaps: () => builder,
    textSearch: () => builder,
    match: () => builder,
    not: () => builder,
    or: () => builder,
    filter: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    single: () => createQueryBuilder(true),
    maybeSingle: () => createQueryBuilder(true),
    csv: () => Promise.resolve({ data: "", error: null }),
    returns: () => builder,
    throwOnError: () => builder,
    then: (
      onFulfilled?: ((value: QueryResult) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(result()).then(onFulfilled, onRejected),
    catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
      Promise.resolve(result()).catch(onRejected),
    finally: (onFinally?: (() => void) | null) => Promise.resolve(result()).finally(onFinally),
  };

  return builder;
}

function createChannelStub() {
  const channel: Record<string, unknown> = {
    on: () => channel,
    subscribe: (cb?: (status: string) => void) => {
      if (typeof cb === "function") cb("CLOSED");
      return channel;
    },
    unsubscribe: () => Promise.resolve("ok"),
    send: () => Promise.resolve("ok"),
    track: () => Promise.resolve("ok"),
    untrack: () => Promise.resolve("ok"),
    presenceState: () => ({}),
  };
  return channel;
}

/**
 * Shown for every auth/DB call when the client fell back to this mock.
 *
 * This used to say "not configured in this preview environment", which sent
 * people hunting for a preview-only bug when the real cause was a production
 * build that never received its Supabase env vars. Name the missing variables
 * so the message is actionable on its own.
 */
const NOT_CONFIGURED_ERROR = {
  message:
    "This deployment isn't connected to Supabase yet, so sign-in and content are unavailable. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rebuild.",
  status: 503,
};

export function createMockSupabaseClient(): SupabaseClient<Database> {
  const subscription = { unsubscribe: () => {} };

  const mock = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      getClaims: async () => ({ data: null, error: null }),
      onAuthStateChange: () => ({ data: { subscription } }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: NOT_CONFIGURED_ERROR,
      }),
      signInWithOtp: async () => ({
        data: { user: null, session: null },
        error: NOT_CONFIGURED_ERROR,
      }),
      verifyOtp: async () => ({ data: { user: null, session: null }, error: NOT_CONFIGURED_ERROR }),
      signInWithOAuth: async () => ({
        data: { provider: "google", url: null },
        error: NOT_CONFIGURED_ERROR,
      }),
      signUp: async () => ({ data: { user: null, session: null }, error: NOT_CONFIGURED_ERROR }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: NOT_CONFIGURED_ERROR }),
      updateUser: async () => ({ data: { user: null }, error: NOT_CONFIGURED_ERROR }),
      setSession: async () => ({ data: { user: null, session: null }, error: null }),
      refreshSession: async () => ({ data: { user: null, session: null }, error: null }),
    },
    from: () => createQueryBuilder(false),
    rpc: () => createQueryBuilder(true),
    channel: () => createChannelStub(),
    removeChannel: async () => "ok",
    removeAllChannels: async () => [],
    getChannels: () => [],
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `/${bucket}/${path}`.replace(/\/+/g, "/") },
        }),
        createSignedUrl: async () => ({ data: null, error: null }),
        createSignedUrls: async () => ({ data: [], error: null }),
        upload: async () => ({ data: null, error: NOT_CONFIGURED_ERROR }),
        download: async () => ({ data: null, error: NOT_CONFIGURED_ERROR }),
        remove: async () => ({ data: [], error: null }),
        list: async () => ({ data: [], error: null }),
      }),
    },
    functions: {
      invoke: async () => ({ data: null, error: NOT_CONFIGURED_ERROR }),
    },
  };

  return mock as unknown as SupabaseClient<Database>;
}
