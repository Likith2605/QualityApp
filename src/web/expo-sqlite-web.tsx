import { createContext, useContext, type ReactNode } from 'react';

const SQLiteContext = createContext<any>(null);

export const defaultDatabaseDirectory: string | undefined = undefined;

export function SQLiteProvider({ children }: { children: ReactNode }) {
  return <SQLiteContext.Provider value={null}>{children}</SQLiteContext.Provider>;
}

export function useSQLiteContext() {
  return useContext(SQLiteContext);
}
