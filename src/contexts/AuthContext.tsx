import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, setAuthToken, clearAuthToken, getAuthToken } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface ModulesEnabled {
  campaigns: boolean;
  billing: boolean;
  groups: boolean;
  scheduled_messages: boolean;
  chatbots: boolean;
  chat: boolean;
  crm: boolean;
  ai_agents: boolean;
  group_secretary: boolean;
  ghost: boolean;
  projects: boolean;
  lead_gleego: boolean;
  doc_signatures: boolean;
  supervisor: boolean;
}

// Page-level permissions from permission templates
export type PagePermissions = Record<string, boolean> | null;

interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  is_superadmin?: boolean;
  organization_id?: string;
  modules_enabled?: ModulesEnabled;
  has_connections?: boolean;
  page_permissions?: PagePermissions;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  modulesEnabled: ModulesEnabled;
  pagePermissions: PagePermissions;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, planId?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const defaultModules: ModulesEnabled = {
    campaigns: true,
    billing: true,
    groups: true,
    scheduled_messages: true,
    chatbots: true,
    chat: true,
    crm: true,
    ai_agents: true,
    group_secretary: false,
    ghost: true,
    projects: false,
    lead_gleego: false,
    doc_signatures: false,
    supervisor: false,
  };

  const refreshUser = async () => {
    const token = getAuthToken();
    if (token) {
      try {
        const { user } = await authApi.getMe();
        setUser(user);
        if (user.organization_id) {
          sessionStorage.setItem('user_org_id', user.organization_id);
        }
      } catch {
        // Ignore errors on refresh
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    const checkAuth = async () => {
      try {
        const token = getAuthToken();
        if (token) {
          try {
            const { user: userData } = await authApi.getMe();
            if (!mounted) return;
            const u = userData as any;
            setUser(u);
            if (u.organization_id) {
              sessionStorage.setItem('user_org_id', u.organization_id);
            }
          } catch {
            clearAuthToken();
          }
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    checkAuth();
    return () => {
      mounted = false;
    };
  }, []);

  // Global 401 handler: when the session token expires server-side (e.g. tab
  // left open for days past the 7-day JWT expiry), any API call fails with
  // 401. Without this, the UI kept showing the user as "logged in" forever
  // while message polling silently failed in the background.
  useEffect(() => {
    const handleUnauthorized = () => {
      if (!getAuthToken()) return;
      clearAuthToken();
      setUser(null);
      toast({
        title: 'Sessão expirada',
        description: 'Faça login novamente para continuar.',
        variant: 'destructive',
      });
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [toast]);

  // Revalidate session when the tab/window regains focus (e.g. after the PC
  // wakes from sleep), so an expired session is caught quickly instead of
  // only when the next background poll happens to fail.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && getAuthToken()) {
        refreshUser();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const login = async (email: string, password: string) => {
    const { user: userData, token } = await authApi.login(email, password);
    setAuthToken(token);
    const u = userData as any;
    setUser(u);
    if (u.organization_id) {
      sessionStorage.setItem('user_org_id', u.organization_id);
    }
    toast({ title: 'Login realizado com sucesso!' });
  };

  const register = async (email: string, password: string, name: string, planId?: string) => {
    const { user, token } = await authApi.register(email, password, name, planId);
    setAuthToken(token);
    setUser(user);
    toast({ title: 'Conta criada com sucesso!' });
  };

  const logout = () => {
    clearAuthToken();
    setUser(null);
    toast({ title: 'Logout realizado' });
  };

  const modulesEnabled = user?.modules_enabled || defaultModules;
  const pagePermissions = user?.page_permissions || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        modulesEnabled,
        pagePermissions,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
