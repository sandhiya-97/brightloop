import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api('/auth/me').then((r) => setUser(r.data)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const value = useMemo(() => ({ user, loading,
    async login(body) { const r = await api('/auth/login', { method: 'POST', body }); setUser(r.data); return r.data; },
    async signup(body) { const r = await api('/auth/signup', { method: 'POST', body }); setUser(r.data); return r.data; },
    async logout() { await api('/auth/logout', { method: 'POST' }); setUser(null); },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
