import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, setToken, SOCKET_URL } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then(({ user: u }) => setUser(u))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // One authenticated socket per session; the server joins it to team rooms.
  useEffect(() => {
    if (!user) return undefined;
    const s = io(SOCKET_URL, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    setSocket(s);
    return () => s.disconnect();
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      socket,
      async login(email, password) {
        const { token, user: u } = await api('/auth/login', { method: 'POST', body: { email, password } });
        setToken(token);
        setUser(u);
      },
      async register(input) {
        const { token, user: u } = await api('/auth/register', { method: 'POST', body: input });
        setToken(token);
        setUser(u);
      },
      logout() {
        setToken(null);
        setUser(null);
      },
    }),
    [user, loading, socket],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Subscribe to a socket event for the lifetime of a component. */
export function useSocketEvent(event, handler) {
  const { socket } = useAuth();
  useEffect(() => {
    if (!socket) return undefined;
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [socket, event, handler]);
}
