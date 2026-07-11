import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api, API_URL, getAuthToken } from '@/lib/api';

export type AnalysisType = 'resumo' | 'ata' | 'pendencias' | 'tarefas';

export interface TelehealthSession {
  id: string;
  organization_id: string;
  created_by: string;
  title: string | null;
  reason: string | null;
  notes: string | null;
  contact_id: string | null;
  contact_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
  status: 'waiting' | 'recording' | 'processing' | 'transcribing' | 'completed' | 'error';
  audio_url: string | null;
  audio_size: number | null;
  audio_duration: number | null;
  transcript: string | null;
  structured_content: Record<string, any> | null;
  error_message: string | null;
  retry_count: number;
  consent_given: boolean;
  attachments: Array<{ name: string; url: string; type: string }>;
  audio_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  audit_logs?: AuditLog[];
}

export interface AuditLog {
  id: string;
  session_id: string;
  user_id: string;
  user_name: string;
  action: string;
  details: any;
  created_at: string;
}

export function useTelehealth() {
  const [sessions, setSessions] = useState<TelehealthSession[]>([]);
  const [currentSession, setCurrentSession] = useState<TelehealthSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSessions = useCallback(async (filters?: { status?: string; contact_id?: string; deal_id?: string; search?: string }) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.contact_id) params.set('contact_id', filters.contact_id);
      if (filters?.deal_id) params.set('deal_id', filters.deal_id);
      if (filters?.search) params.set('search', filters.search);
      const qs = params.toString();
      const data = await api<TelehealthSession[]>(`/api/telehealth${qs ? '?' + qs : ''}`, { auth: true });
      setSessions(data);
    } catch (e: any) {
      toast.error('Erro ao carregar sessões');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSession = useCallback(async (id: string) => {
    try {
      const data = await api<TelehealthSession>(`/api/telehealth/${id}`, { auth: true });
      setCurrentSession(data);
      return data;
    } catch (e: any) {
      toast.error('Erro ao carregar sessão');
      return null;
    }
  }, []);

  const createSession = useCallback(async (data: Partial<TelehealthSession>) => {
    try {
      const session = await api<TelehealthSession>('/api/telehealth', { method: 'POST', body: data, auth: true });
      toast.success('Sessão criada');
      return session;
    } catch (e: any) {
      toast.error('Erro ao criar sessão');
      return null;
    }
  }, []);

  const updateSession = useCallback(async (id: string, data: Partial<TelehealthSession>) => {
    try {
      const session = await api<TelehealthSession>(`/api/telehealth/${id}`, { method: 'PATCH', body: data, auth: true });
      toast.success('Sessão atualizada');
      return session;
    } catch (e: any) {
      toast.error('Erro ao atualizar sessão');
      return null;
    }
  }, []);

  const uploadAudio = useCallback(async (sessionId: string, audioBlob: Blob, reason: string, notes: string, duration: number) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      const token = getAuthToken();
      const resp = await fetch(`${API_URL}/api/telehealth/${sessionId}/audio`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Session-Reason': encodeURIComponent(reason),
          'X-Session-Notes': encodeURIComponent(notes),
          'X-Session-Duration': String(duration),
        },
        body: formData,
      });
      if (!resp.ok) throw new Error('Upload falhou');
      const session = await resp.json();
      toast.success('Áudio enviado para transcrição');
      return session;
    } catch (e: any) {
      toast.error('Erro ao enviar áudio');
      return null;
    }
  }, []);

  // Chunked upload — resilient for long recordings
  const uploadChunk = useCallback(async (
    sessionId: string,
    chunk: Blob,
    index: number,
    opts: { maxRetries?: number } = {}
  ): Promise<boolean> => {
    const maxRetries = opts.maxRetries ?? 5;
    const token = getAuthToken();
    const formData = new FormData();
    formData.append('chunk', chunk, `chunk_${index}.part`);
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await fetch(`${API_URL}/api/telehealth/${sessionId}/audio/chunk`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'X-Chunk-Index': String(index),
          },
          body: formData,
        });
        if (resp.ok) return true;
        // Non-retryable errors
        if (resp.status === 401 || resp.status === 403 || resp.status === 404) return false;
      } catch {
        // network error — will retry
      }
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      await new Promise(r => setTimeout(r, Math.min(16000, 1000 * Math.pow(2, attempt))));
    }
    return false;
  }, []);

  const finalizeChunkedUpload = useCallback(async (
    sessionId: string,
    args: { reason: string; notes: string; duration: number; mime: string; totalChunks: number }
  ) => {
    try {
      const session = await api<TelehealthSession>(`/api/telehealth/${sessionId}/audio/finalize`, {
        method: 'POST',
        body: {
          reason: args.reason,
          notes: args.notes,
          duration: args.duration,
          mime: args.mime,
          total_chunks: args.totalChunks,
        },
        auth: true,
      });
      toast.success('Gravação enviada para transcrição');
      return session;
    } catch {
      toast.error('Erro ao finalizar upload');
      return null;
    }
  }, []);

  const retryProcessing = useCallback(async (id: string) => {
    try {
      const session = await api<TelehealthSession>(`/api/telehealth/${id}/retry`, { method: 'POST', auth: true });
      toast.success('Reprocessamento iniciado');
      return session;
    } catch (e: any) {
      toast.error('Erro ao tentar novamente');
      return null;
    }
  }, []);

  const analyzeSession = useCallback(async (id: string, promptType: AnalysisType) => {
    try {
      const result = await api<{ type: string; data: any }>(`/api/telehealth/${id}/analyze`, {
        method: 'POST',
        body: { prompt_type: promptType },
        auth: true,
      });
      toast.success('Análise concluída');
      return result;
    } catch (e: any) {
      toast.error('Erro ao analisar sessão');
      return null;
    }
  }, []);

  const askQuestion = useCallback(async (
    id: string,
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => {
    try {
      const result = await api<{ answer: string }>(`/api/telehealth/${id}/ask`, {
        method: 'POST',
        body: { question, history },
        auth: true,
      });
      return result.answer;
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao consultar IA');
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api(`/api/telehealth/${id}`, { method: 'DELETE', auth: true });
      toast.success('Sessão excluída');
    } catch (e: any) {
      toast.error('Erro ao excluir sessão');
    }
  }, []);

  return {
    sessions,
    currentSession,
    isLoading,
    fetchSessions,
    fetchSession,
    createSession,
    updateSession,
    uploadAudio,
    uploadChunk,
    finalizeChunkedUpload,
    retryProcessing,
    analyzeSession,
    askQuestion,
    deleteSession,
  };
}
