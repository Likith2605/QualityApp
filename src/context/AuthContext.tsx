import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { login as dbLogin, saveAuthenticatedEmployee } from '../db/repo';
import { getServerUrl, serverLogin, serverLogout, setAutoSyncEnabled } from '../db/sync';
import type { Employee } from '../db/types';

interface AuthContextValue {
  user: Employee | null;
  ready: boolean;
  login: (
    employeeId: string,
    password: string
  ) => Promise<{ error: string | null; employee: Employee | null }>;
  completeLogin: (employee: Employee) => Promise<void>;
  logout: () => Promise<void>;
}

const SESSION_KEY = 'session_user';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  ready: false,
  login: async () => ({ error: null, employee: null }),
  completeLogin: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [user, setUser] = useState<Employee | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await Storage.getItem(SESSION_KEY);
        if (active && raw) {
          const employee = JSON.parse(raw) as Employee;
          if (employee.employee_id) setUser(employee);
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = async (
    employeeId: string,
    password: string
  ): Promise<{ error: string | null; employee: Employee | null }> => {
    if (!employeeId.trim() || !password) {
      return { error: 'Please enter Employee ID and Password', employee: null };
    }
    const emp = await dbLogin(db, employeeId, password);
    if (emp) {
      return { error: null, employee: emp };
    }

    if (!(await getServerUrl())) {
      return { error: 'Invalid Employee ID or Password', employee: null };
    }

    const result = await serverLogin(employeeId.trim(), password);
    if (!result.ok || !result.employee) {
      const error =
        result.message === 'Invalid credentials'
          ? 'Invalid Employee ID or Password'
          : `Unable to verify login with the sync server: ${result.message}`;
      return { error, employee: null };
    }

    const authenticatedEmployee = await saveAuthenticatedEmployee(
      db,
      result.employee,
      password
    );
    return { error: null, employee: authenticatedEmployee };
  };

  const completeLogin = async (employee: Employee) => {
    await Storage.setItem(SESSION_KEY, JSON.stringify(employee));
    setUser(employee);
  };

  const logout = async () => {
    setAutoSyncEnabled(false);
    setUser(null);
    await Storage.removeItem(SESSION_KEY);
    await serverLogout();
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, completeLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
