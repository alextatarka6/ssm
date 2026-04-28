const MOCK_USER_ID = "mock-admin-user";
const MOCK_SESSION = {
  user: { id: MOCK_USER_ID, email: "dev@example.com" },
  access_token: "mock-access-token",
};

const listeners = new Set();

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: MOCK_SESSION }, error: null }),
    onAuthStateChange: (callback) => {
      callback("SIGNED_IN", MOCK_SESSION);
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    signInWithOAuth: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: { session: MOCK_SESSION }, error: null }),
    signUp: async () => ({ data: { session: MOCK_SESSION }, error: null }),
    signOut: async () => {
      listeners.forEach((cb) => cb("SIGNED_OUT", null));
      return { error: null };
    },
    updateUser: async () => ({ data: { user: MOCK_SESSION.user }, error: null }),
    resend: async () => ({ error: null }),
  },
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
    }),
  },
};
