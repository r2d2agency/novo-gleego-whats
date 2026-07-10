import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTelehealth, TelehealthSession, AnalysisType } from '@/hooks/use-telehealth';
import { RecordingModal } from '@/components/telehealth/RecordingModal';
import { SessionDetailDialog } from '@/components/telehealth/SessionDetailDialog';
import { NewSessionDialog } from '@/components/telehealth/NewSessionDialog';
import { Plus, Search, Mic, Trash2, Eye, Clock, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  waiting: { label: 'Aguardando', color: 'bg-muted text-muted-foreground', icon: Clock },
  recording: { label: 'Gravando', color: 'bg-destructive text-destructive-foreground', icon: Mic },
  processing: { label: 'Processando', color: 'bg-blue-500 text-white', icon: Loader2 },
  transcribing: { label: 'Transcrevendo', color: 'bg-blue-500 text-white', icon: Loader2 },
  completed: { label: 'Concluído', color: 'bg-green-500 text-white', icon: CheckCircle2 },
  error: { label: 'Erro', color: 'bg-destructive text-destructive-foreground', icon: XCircle },
};

export default function Teleatendimento() {
  const { sessions, isLoading, fetchSessions, createSession, updateSession, uploadAudio, retryProcessing, deleteSession, fetchSession, analyzeSession } = useTelehealth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [recordingSession, setRecordingSession] = useState<TelehealthSession | null>(null);
  const [detailSession, setDetailSession] = useState<TelehealthSession | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    fetchSessions({ status: statusFilter === 'all' ? undefined : statusFilter, search: search || undefined });
  }, [fetchSessions, statusFilter, search]);

  // Poll for processing sessions
  useEffect(() => {
    const hasProcessing = sessions.some(s => ['processing', 'transcribing'].includes(s.status));
    if (!hasProcessing) return;
    const interval = setInterval(() => {
      fetchSessions({ status: statusFilter === 'all' ? undefined : statusFilter, search: search || undefined });
    }, 5000);
    return () => clearInterval(interval);
  }, [sessions, fetchSessions, statusFilter, search]);

  const handleCreate = useCallback(async (data: any) => {
    const session = await createSession(data);
    if (session) {
      setShowNewDialog(false);
      fetchSessions();
    }
  }, [createSession, fetchSessions]);

  const handleStartRecording = useCallback((session: TelehealthSession) => {
    setRecordingSession(session);
  }, []);

  const handleFinishRecording = useCallback(async ({ attachments }: { reason: string; notes: string; duration: number; attachments: any[] }) => {
    if (!recordingSession) return;
    if (attachments.length > 0) {
      await updateSession(recordingSession.id, { attachments } as any);
    }
    setRecordingSession(null);
    fetchSessions();
  }, [recordingSession, updateSession, fetchSessions]);

  const handleViewDetail = useCallback(async (session: TelehealthSession) => {
    const full = await fetchSession(session.id);
    if (full) { setDetailSession(full); setShowDetail(true); }
  }, [fetchSession]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Excluir esta sessão?')) return;
    await deleteSession(id);
    fetchSessions();
  }, [deleteSession, fetchSessions]);

  const handleRetry = useCallback(async (id: string) => {
    await retryProcessing(id);
    fetchSessions();
  }, [retryProcessing, fetchSessions]);

  const handleAnalyze = useCallback(async (id: string, type: AnalysisType) => {
    const result = await analyzeSession(id, type);
    if (result) {
      // Refresh session detail
      const updated = await fetchSession(id);
      if (updated) setDetailSession(updated);
    }
    return result;
  }, [analyzeSession, fetchSession]);

  const handleCreateTask = useCallback((task: any) => {
    toast.success(`Tarefa "${task.titulo}" criada! (integração com Kanban em breve)`);
    // TODO: integrate with task-boards API
  }, []);

  const handleScheduleReturn = useCallback((retorno: any) => {
    toast.success(`Retorno agendado: ${retorno.descricao}`);
    // TODO: integrate with CRM tasks/calendar
  }, []);

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Teleatendimento</h1>
            <p className="text-muted-foreground">Grave, transcreva e organize reuniões automaticamente</p>
          </div>
          <Button onClick={() => setShowNewDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nova Sessão
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar sessões..." className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="waiting">Aguardando</SelectItem>
              <SelectItem value="processing">Processando</SelectItem>
              <SelectItem value="completed">Concluído</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sessions list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Mic className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhuma sessão encontrada</p>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowNewDialog(true)}>
                <Plus className="h-4 w-4" /> Criar primeira sessão
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {sessions.map(session => {
              const statusInfo = STATUS_CONFIG[session.status] || STATUS_CONFIG.waiting;
              const StatusIcon = statusInfo.icon;
              return (
                <Card key={session.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium truncate">{session.title || 'Sem título'}</h3>
                          <Badge className={cn('shrink-0 text-xs', statusInfo.color)}>
                            <StatusIcon className={cn("h-3 w-3 mr-1", ['processing', 'transcribing'].includes(session.status) && 'animate-spin')} />
                            {statusInfo.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                          {session.contact_name && <span>👤 {session.contact_name}</span>}
                          {session.deal_title && <span>💼 {session.deal_title}</span>}
                          {session.audio_duration && <span>🎙 {Math.floor(session.audio_duration / 60)}:{(session.audio_duration % 60).toString().padStart(2, '0')}</span>}
                          <span>{new Date(session.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                        {session.reason && <p className="text-sm text-muted-foreground mt-1 truncate">{session.reason}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {session.status === 'waiting' && (
                          <Button size="sm" variant="default" className="gap-1" onClick={() => handleStartRecording(session)}>
                            <Mic className="h-3 w-3" /> Gravar
                          </Button>
                        )}
                        {session.status === 'error' && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleRetry(session.id)}>
                            <RefreshCw className="h-3 w-3" /> Retry
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => handleViewDetail(session)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDelete(session.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <NewSessionDialog open={showNewDialog} onClose={() => setShowNewDialog(false)} onCreate={handleCreate} />
      <RecordingModal
        open={!!recordingSession}
        onClose={() => setRecordingSession(null)}
        sessionId={recordingSession?.id}
        onFinished={handleFinishRecording}
        sessionTitle={recordingSession?.title || undefined}
      />
      <SessionDetailDialog
        session={detailSession}
        open={showDetail}
        onClose={() => setShowDetail(false)}
        onRetry={handleRetry}
        onAnalyze={handleAnalyze}
        onCreateTask={handleCreateTask}
        onScheduleReturn={handleScheduleReturn}
      />
    </MainLayout>
  );
}
