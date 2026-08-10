import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { login as dbLogin } from '../db/repo';
import type { Employee } from '../db/types';

interface AuthContextValue {
  user: Employee | null;
  ready: boolean;
  login: (employeeId: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const SESSION_KEY = 'session_user';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  ready: false,
  login: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [user, setUser] = useState<Employee | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await Storage.getItem(SESSION_KEY);
        if (raw) {
          setUser(JSON.parse(raw));
        }
      } catch {
        setUser(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = async (employeeId: string, password: string): Promise<string | null> => {
    if (!employeeId.trim() || !password) {
      return 'Please enter Employee ID and Password';
    }
    const emp = await dbLogin(db, employeeId, password);
    if (!emp) {
      return 'Invalid Employee ID or Password';
    }
    setUser(emp);
    await Storage.setItem(SESSION_KEY, JSON.stringify(emp));
    return null;
  };

  const logout = async () => {
    setUser(null);
    await Storage.removeItem(SESSION_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
