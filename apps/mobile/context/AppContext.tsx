import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBootstrap, type Bootstrap } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";

type AppCtx = {
  session: Session | null;
  bootstrap: Bootstrap | null;
  viewAs: string | null;
  setViewAs: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  configured: boolean;
};

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [viewAs, setViewAsState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured) return;
    setError(null);
    try {
      const data = await getBootstrap(viewAs);
      setBootstrap(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }, [viewAs]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) refresh().finally(() => setLoading(false));
    else setBootstrap(null);
  }, [session, refresh]);

  const setViewAs = useCallback((id: string | null) => {
    setViewAsState(id);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setViewAsState(null);
    setBootstrap(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      bootstrap,
      viewAs,
      setViewAs,
      loading,
      error,
      refresh,
      signIn,
      signOut,
      configured: supabaseConfigured,
    }),
    [session, bootstrap, viewAs, setViewAs, loading, error, refresh, signIn, signOut]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
