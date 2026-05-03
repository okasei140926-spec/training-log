import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const missingSupabaseEnvKeys = [
  !supabaseUrl ? "REACT_APP_SUPABASE_URL" : null,
  !supabaseAnonKey ? "REACT_APP_SUPABASE_ANON_KEY" : null,
].filter(Boolean);

export const isSupabaseConfigured = missingSupabaseEnvKeys.length === 0;

export const supabaseConfigError = isSupabaseConfigured
  ? ""
  : `Supabase環境変数が不足しています: ${missingSupabaseEnvKeys.join(", ")}`;

const createUnavailableMethod = () => async () => {
  throw new Error(supabaseConfigError);
};

const noopSubscription = {
  unsubscribe() { },
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: noopSubscription } }),
      getUser: createUnavailableMethod(),
      signOut: createUnavailableMethod(),
      signUp: createUnavailableMethod(),
      resetPasswordForEmail: createUnavailableMethod(),
      signInWithPassword: createUnavailableMethod(),
    },
    from: () => {
      throw new Error(supabaseConfigError);
    },
    storage: {
      from: () => {
        throw new Error(supabaseConfigError);
      },
    },
  };
