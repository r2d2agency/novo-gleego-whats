import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface GlobalAgentCustomField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required?: boolean;
  options?: string[]; // for select type
  placeholder?: string;
}

export interface GlobalAgentActivation {
  id: string;
  connection_id: string;
  is_active: boolean;
  schedule_mode: 'always' | 'scheduled' | 'manual';
  schedule_windows: ScheduleWindow[];
  custom_field_values: Record<string, string>;
  prompt_additions?: string;
  client_ai_api_key?: string;
  connection_name?: string;
  connection_phone?: string;
}

export interface ScheduleWindow {
  days: number[]; // 0=domingo, 1=segunda...6=sábado
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

export interface GlobalAgentForClient {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  custom_fields: GlobalAgentCustomField[];
  system_prompt: string;
  greeting_message?: string;
  ai_provider?: string;
  ai_model?: string;
  capabilities?: string[];
  has_knowledge_base?: boolean;
  appbarber_api_key?: string;
  appbarber_establishment_code?: string;
  activations: GlobalAgentActivation[];
}

export interface AppBarberService {
  id: string;
  agent_id: string;
  organization_id: string;
  service_code: number;
  service_description: string;
  service_value: number;
  service_interval: number;
  is_active: boolean;
  synced_from_api: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppBarberProfessional {
  id: string;
  agent_id: string;
  organization_id: string;
  employee_code: number;
  employee_name: string;
  employee_nickname: string | null;
  is_active: boolean;
  synced_from_api: boolean;
  created_at: string;
  updated_at: string;
}

export function useGlobalAgents() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAvailableAgents = useCallback(async (): Promise<GlobalAgentForClient[]> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<GlobalAgentForClient[]>('/api/global-agents/available', { auth: true });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar agentes';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const activateAgent = useCallback(async (data: {
    global_agent_id: string;
    connection_id: string;
    schedule_mode: string;
    schedule_windows: ScheduleWindow[];
    custom_field_values: Record<string, string>;
    prompt_additions?: string;
    client_ai_api_key?: string;
  }): Promise<GlobalAgentActivation | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<GlobalAgentActivation>('/api/global-agents/activate', {
        method: 'POST',
        body: data,
        auth: true,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao ativar agente';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateActivation = useCallback(async (id: string, data: Partial<GlobalAgentActivation>): Promise<GlobalAgentActivation | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<GlobalAgentActivation>(`/api/global-agents/activation/${id}`, {
        method: 'PATCH',
        body: data,
        auth: true,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao atualizar ativação';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deactivateAgent = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      await api(`/api/global-agents/deactivate/${id}`, { method: 'POST', auth: true });
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteActivation = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      await api(`/api/global-agents/activation/${id}`, { method: 'DELETE', auth: true });
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const getAIModels = useCallback(async () => {
    try {
      return await api<Record<string, { id: string; name: string; description: string }[]>>('/api/global-agents/models', { auth: true });
    } catch {
      return { openai: [], gemini: [] };
    }
  }, []);

  const testAgent = useCallback(async (agentId: string, data: {
    message: string;
    history?: { role: string; content: string }[];
    client_ai_api_key?: string;
    custom_name?: string;
    prompt_additions?: string;
    selected_model?: string;
    activation_id?: string;
    connection_id?: string;
  }) => {
    const result = await api<{ response: string; tokens: number; model: string }>(`/api/global-agents/test/${agentId}`, {
      method: 'POST',
      body: data,
      auth: true,
    });
    return result;
  }, []);

  // ==================== APPBARBER GLOBAL SERVICES ====================

  const getGlobalAppBarberServices = useCallback(async (agentId: string): Promise<AppBarberService[]> => {
    try {
      return await api<AppBarberService[]>(`/api/global-agents/admin/${agentId}/appbarber-services`, { auth: true });
    } catch {
      return [];
    }
  }, []);

  const saveGlobalAppBarberService = useCallback(async (agentId: string, data: Partial<AppBarberService>): Promise<AppBarberService | null> => {
    try {
      return await api<AppBarberService>(`/api/global-agents/admin/${agentId}/appbarber-services`, {
        method: 'POST',
        body: data,
        auth: true,
      });
    } catch {
      return null;
    }
  }, []);

  const syncGlobalAppBarberServices = useCallback(async (agentId: string, credentials?: { appbarber_api_key?: string; appbarber_establishment_code?: string; type?: number }): Promise<{ imported: number; total?: number; source?: string; code?: string } | null> => {
    try {
      return await api<{ imported: number; total?: number; source?: string; code?: string }>(`/api/global-agents/admin/${agentId}/appbarber-services/sync`, {
        method: 'POST',
        body: credentials || {},
        auth: true,
      });
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Erro ao sincronizar serviços');
    }
  }, []);

  // ==================== APPBARBER GLOBAL PROFESSIONALS ====================

  const getGlobalAppBarberProfessionals = useCallback(async (agentId: string): Promise<AppBarberProfessional[]> => {
    try {
      return await api<AppBarberProfessional[]>(`/api/global-agents/admin/${agentId}/appbarber-professionals`, { auth: true });
    } catch {
      return [];
    }
  }, []);

  const saveGlobalAppBarberProfessional = useCallback(async (agentId: string, data: Partial<AppBarberProfessional>): Promise<AppBarberProfessional | null> => {
    try {
      return await api<AppBarberProfessional>(`/api/global-agents/admin/${agentId}/appbarber-professionals`, {
        method: 'POST',
        body: data,
        auth: true,
      });
    } catch {
      return null;
    }
  }, []);

  const syncGlobalAppBarberProfessionals = useCallback(async (agentId: string, credentials?: { appbarber_api_key?: string; appbarber_establishment_code?: string }): Promise<{ imported: number; total?: number; source?: string } | null> => {
    try {
      return await api<{ imported: number; total?: number; source?: string }>(`/api/global-agents/admin/${agentId}/appbarber-professionals/sync`, {
        method: 'POST',
        body: credentials || {},
        auth: true,
      });
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Erro ao sincronizar profissionais');
    }
  }, []);

  return { 
    loading, 
    error, 
    getAvailableAgents, 
    activateAgent, 
    updateActivation, 
    deactivateAgent, 
    deleteActivation, 
    getAIModels, 
    testAgent,
    // Global AppBarber
    getGlobalAppBarberServices,
    saveGlobalAppBarberService,
    syncGlobalAppBarberServices,
    getGlobalAppBarberProfessionals,
    saveGlobalAppBarberProfessional,
    syncGlobalAppBarberProfessionals
  };
}

