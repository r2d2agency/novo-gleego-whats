import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, FileText, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, Upload, Mic, ListTodo, ClipboardList, AlertCircle, FileCheck, CalendarPlus, Plus, Send, Sparkles, MessageCircle } from 'lucide-react';
import { TelehealthSession, AnalysisType } from '@/hooks/use-telehealth';
import { useTelehealth } from '@/hooks/use-telehealth';
import { cn } from '@/lib/utils';

interface SessionDetailDialogProps {
  session: TelehealthSession | null;
  open: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  onAnalyze?: (id: string, type: AnalysisType) => Promise<any>;
  onCreateTask?: (task: { titulo: string; descricao: string; responsavel?: string; prazo?: string; prioridade?: string }) => void;
  onScheduleReturn?: (retorno: { descricao: string; data_sugerida?: string; participantes?: string[] }) => void;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  waiting: { label: 'Aguardando', color: 'bg-muted text-muted-foreground', icon: Clock },
  recording: { label: 'Gravando', color: 'bg-destructive text-destructive-foreground', icon: Mic },
  processing: { label: 'Processando', color: 'bg-blue-500 text-white', icon: Loader2 },
  transcribing: { label: 'Transcrevendo', color: 'bg-blue-500 text-white', icon: Loader2 },
  completed: { label: 'Concluído', color: 'bg-green-500 text-white', icon: CheckCircle2 },
  error: { label: 'Erro', color: 'bg-destructive text-destructive-foreground', icon: XCircle },
};

const PIPELINE_STEPS = ['processing', 'transcribing', 'completed'];

const ANALYSIS_OPTIONS: { type: AnalysisType; label: string; icon: any; desc: string }[] = [
  { type: 'resumo', label: 'Resumo da Reunião', icon: FileCheck, desc: 'Gera um resumo executivo com pontos principais' },
  { type: 'ata', label: 'Ata da Reunião', icon: ClipboardList, desc: 'Ata formal com pauta, discussões e deliberações' },
  { type: 'pendencias', label: 'Pendências', icon: AlertCircle, desc: 'Identifica itens em aberto e compromissos' },
  { type: 'tarefas', label: 'Tarefas e Ações', icon: ListTodo, desc: 'Extrai tarefas, responsáveis e próximos passos' },
];

export function SessionDetailDialog({ session, open, onClose, onRetry, onAnalyze, onCreateTask, onScheduleReturn }: SessionDetailDialogProps) {
  const [analyzingType, setAnalyzingType] = useState<AnalysisType | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisType | null>(null);
  const { askQuestion } = useTelehealth();
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset chat when switching session
    setChatMessages([]);
    setChatInput('');
  }, [session?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  if (!session) return null;

  const statusInfo = STATUS_MAP[session.status] || STATUS_MAP.waiting;
  const StatusIcon = statusInfo.icon;
  const currentStepIndex = PIPELINE_STEPS.indexOf(session.status);
  const hasTranscript = !!session.transcript;
  const structuredContent = session.structured_content || {};

  const SUGGESTED_QUESTIONS = [
    'Quais foram os principais assuntos discutidos?',
    'Quem participou da reunião?',
    'Quais compromissos foram assumidos e por quem?',
    'Quais são os próximos passos?',
  ];

  const sendChat = async (text?: string) => {
    const q = (text ?? chatInput).trim();
    if (!q || chatLoading || !session) return;
    const nextHistory = [...chatMessages, { role: 'user' as const, content: q }];
    setChatMessages(nextHistory);
    setChatInput('');
    setChatLoading(true);
    const answer = await askQuestion(session.id, q, chatMessages);
    setChatLoading(false);
    if (answer) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    }
  };

  const handleAnalyze = async (type: AnalysisType) => {
    if (!onAnalyze) return;
    setAnalyzingType(type);
    const result = await onAnalyze(session.id, type);
    setAnalyzingType(null);
    if (result) {
      setActiveAnalysis(type);
      // Update local structured content
      structuredContent[type] = result.data;
    }
  };

  const renderAnalysisResult = (type: AnalysisType) => {
    const data = structuredContent[type];
    if (!data) return null;

    // Defensive: data may be a string or contain raw object from older buggy backend
    if (typeof data === 'string') {
      return <p className="text-sm whitespace-pre-wrap">{data}</p>;
    }

    if (data.raw !== undefined) {
      const rawText = typeof data.raw === 'string' ? data.raw : JSON.stringify(data.raw, null, 2);
      return <pre className="text-sm whitespace-pre-wrap font-sans">{rawText}</pre>;
    }

    switch (type) {
      case 'resumo':
        return (
          <div className="space-y-3">
            {data.titulo && <h4 className="font-medium">{data.titulo}</h4>}
            {data.participantes?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Participantes:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {data.participantes.map((p: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.resumo && <p className="text-sm">{data.resumo}</p>}
            {data.pontos_principais?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Pontos Principais:</span>
                <ul className="list-disc list-inside text-sm mt-1 space-y-1">
                  {data.pontos_principais.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'ata':
        return (
          <div className="space-y-3">
            {data.titulo && <h4 className="font-medium">{data.titulo}</h4>}
            {data.participantes?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Participantes:</span>
                <span className="text-sm ml-1">{data.participantes.join(', ')}</span>
              </div>
            )}
            {data.pauta?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Pauta:</span>
                <ul className="list-decimal list-inside text-sm mt-1 space-y-1">
                  {data.pauta.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {data.discussoes?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Discussões:</span>
                <div className="space-y-2 mt-1">
                  {data.discussoes.map((d: any, i: number) => (
                    <div key={i} className="p-2 bg-muted rounded text-sm">
                      <strong>{d.tema}</strong>: {d.detalhes}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.deliberacoes?.length > 0 && (
              <div>
                <span className="text-sm font-medium text-muted-foreground">Deliberações:</span>
                <ul className="list-disc list-inside text-sm mt-1 space-y-1">
                  {data.deliberacoes.map((d: string, i: number) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'pendencias':
        return (
          <div className="space-y-2">
            {data.pendencias?.map((p: any, i: number) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-muted rounded text-sm">
                <AlertCircle className={cn("h-4 w-4 mt-0.5 shrink-0", p.prioridade === 'alta' ? 'text-destructive' : p.prioridade === 'media' ? 'text-yellow-500' : 'text-muted-foreground')} />
                <div className="flex-1">
                  <p>{p.descricao}</p>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    {p.responsavel && <span>👤 {p.responsavel}</span>}
                    {p.prazo && <span>📅 {p.prazo}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );

      case 'tarefas':
        return (
          <div className="space-y-4">
            {data.tarefas?.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">Tarefas Identificadas:</span>
                {data.tarefas.map((t: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-3 border rounded-lg text-sm">
                    <ListTodo className={cn("h-4 w-4 mt-0.5 shrink-0", t.prioridade === 'alta' ? 'text-destructive' : t.prioridade === 'media' ? 'text-yellow-500' : 'text-green-500')} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{t.titulo}</p>
                      {t.descricao && <p className="text-muted-foreground mt-0.5">{t.descricao}</p>}
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {t.responsavel && <span>👤 {t.responsavel}</span>}
                        {t.prazo && <span>📅 {t.prazo}</span>}
                      </div>
                    </div>
                    {onCreateTask && (
                      <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => onCreateTask(t)}>
                        <Plus className="h-3 w-3" /> Criar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {data.retornos?.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">Retornos Sugeridos:</span>
                {data.retornos.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-3 border rounded-lg text-sm border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
                    <CalendarPlus className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                    <div className="flex-1 min-w-0">
                      <p>{r.descricao}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {r.data_sugerida && <span>📅 {r.data_sugerida}</span>}
                        {r.participantes?.length > 0 && <span>👥 {r.participantes.join(', ')}</span>}
                      </div>
                    </div>
                    {onScheduleReturn && (
                      <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => onScheduleReturn(r)}>
                        <CalendarPlus className="h-3 w-3" /> Agendar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      default:
        return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl h-[90vh] !flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 px-6 pt-6 pb-2">
            <span className="truncate">{session.title || 'Sessão sem título'}</span>
            <Badge className={cn('shrink-0', statusInfo.color)}>
              <StatusIcon className={cn("h-3 w-3 mr-1", ['processing', 'transcribing'].includes(session.status) && 'animate-spin')} />
              {statusInfo.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Pipeline tracker */}
        {['processing', 'transcribing', 'completed', 'error'].includes(session.status) && (
          <div className="flex items-center gap-1 px-6 mb-2">
            {[
              { key: 'processing', label: 'Enviado', icon: Upload },
              { key: 'transcribing', label: 'Transcrevendo', icon: Mic },
              { key: 'completed', label: 'Concluído', icon: CheckCircle2 },
            ].map((step, i) => {
              const stepIdx = PIPELINE_STEPS.indexOf(step.key);
              const isDone = currentStepIndex > stepIdx || session.status === 'completed';
              const isActive = session.status === step.key;
              const isError = session.status === 'error' && currentStepIndex === stepIdx;
              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className={cn(
                    "flex flex-col items-center gap-1",
                    isDone ? "text-green-500" : isActive ? "text-primary" : isError ? "text-destructive" : "text-muted-foreground"
                  )}>
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center border-2",
                      isDone ? "border-green-500 bg-green-500/10" : isActive ? "border-primary bg-primary/10" : isError ? "border-destructive bg-destructive/10" : "border-muted"
                    )}>
                      <step.icon className={cn("h-4 w-4", isActive && "animate-pulse")} />
                    </div>
                    <span className="text-[10px] font-medium">{step.label}</span>
                  </div>
                  {i < 2 && <div className={cn("flex-1 h-0.5 mx-1", isDone ? "bg-green-500" : "bg-muted")} />}
                </div>
              );
            })}
          </div>
        )}

        {(session.status === 'error' || ((session.status === 'processing' || session.status === 'transcribing') && !session.transcript)) && (
          <div className="flex items-center gap-2 m-6 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm flex-1">
              {session.status === 'error'
                ? (session.error_message || 'Erro no processamento')
                : 'Processamento travado — clique para reprocessar com a IA da organização.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => onRetry(session.id)} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Reprocessar
            </Button>
          </div>
        )}

        <Tabs defaultValue="info" className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList className="mx-6">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="transcript">Transcrição</TabsTrigger>
            <TabsTrigger value="analysis">Análise IA</TabsTrigger>
            <TabsTrigger value="chat">Perguntar à IA</TabsTrigger>
            <TabsTrigger value="audit">Auditoria</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 px-6 pb-6">
            <TabsContent value="info" className="py-4 space-y-3 m-0">
              {session.contact_name && <div><span className="text-sm font-medium text-muted-foreground">Contato:</span> <span className="text-sm">{session.contact_name}</span></div>}
              {session.deal_title && <div><span className="text-sm font-medium text-muted-foreground">Negociação:</span> <span className="text-sm">{session.deal_title}</span></div>}
              {session.reason && <div><span className="text-sm font-medium text-muted-foreground">Motivo:</span> <p className="text-sm mt-1">{session.reason}</p></div>}
              {session.notes && <div><span className="text-sm font-medium text-muted-foreground">Anotações:</span> <p className="text-sm mt-1 whitespace-pre-wrap">{session.notes}</p></div>}
              {session.audio_duration && <div><span className="text-sm font-medium text-muted-foreground">Duração do áudio:</span> <span className="text-sm">{Math.floor(session.audio_duration / 60)}:{(session.audio_duration % 60).toString().padStart(2, '0')}</span></div>}
              {session.attachments?.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Anexos:</span>
                  <div className="mt-1 space-y-1">
                    {session.attachments.map((att, i) => (
                      <a key={i} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                        <FileText className="h-4 w-4" /> {att.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div><span className="text-sm font-medium text-muted-foreground">Criado em:</span> <span className="text-sm">{new Date(session.created_at).toLocaleString('pt-BR')}</span></div>
            </TabsContent>

            <TabsContent value="transcript" className="py-4 m-0">
              {session.transcript ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{session.transcript}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Transcrição não disponível ainda.</p>
              )}
            </TabsContent>

            <TabsContent value="analysis" className="py-4 m-0 space-y-4">
              {!hasTranscript ? (
                <p className="text-sm text-muted-foreground">Aguardando transcrição para habilitar análises.</p>
              ) : (
                <>
                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    {ANALYSIS_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      const isLoading = analyzingType === opt.type;
                      const hasResult = !!structuredContent[opt.type];
                      return (
                        <Button
                          key={opt.type}
                          variant={hasResult ? 'default' : 'outline'}
                          className="h-auto flex-col items-start gap-1 p-3 text-left"
                          disabled={!!analyzingType}
                          onClick={() => hasResult ? setActiveAnalysis(opt.type) : handleAnalyze(opt.type)}
                        >
                          <div className="flex items-center gap-2">
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                            <span className="text-sm font-medium">{opt.label}</span>
                          </div>
                          <span className="text-xs text-muted-foreground font-normal">{hasResult ? 'Clique para ver' : opt.desc}</span>
                        </Button>
                      );
                    })}
                  </div>

                  {/* Active analysis result */}
                  {activeAnalysis && structuredContent[activeAnalysis] && (
                    <Card>
                      <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                        <CardTitle className="text-sm">
                          {ANALYSIS_OPTIONS.find(o => o.type === activeAnalysis)?.label}
                        </CardTitle>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => handleAnalyze(activeAnalysis)} disabled={!!analyzingType}>
                            <RefreshCw className={cn("h-3 w-3", analyzingType === activeAnalysis && "animate-spin")} /> Refazer
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActiveAnalysis(null)}>✕</Button>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 pt-0">
                        {renderAnalysisResult(activeAnalysis)}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="audit" className="py-4 m-0">
            </TabsContent>

            <TabsContent value="chat" className="py-4 m-0">
              {!hasTranscript ? (
                <p className="text-sm text-muted-foreground">Aguardando transcrição para habilitar perguntas.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <p>A IA responderá <strong>somente com base na transcrição</strong> desta reunião. Se a informação não estiver na gravação, ela dirá.</p>
                  </div>

                  {chatMessages.length === 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Sugestões:</p>
                      <div className="flex flex-wrap gap-2">
                        {SUGGESTED_QUESTIONS.map((q, i) => (
                          <Button key={i} size="sm" variant="outline" className="h-auto py-1.5 text-xs whitespace-normal text-left" onClick={() => sendChat(q)} disabled={chatLoading}>
                            {q}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {chatMessages.map((m, i) => (
                      <div key={i} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                          m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        )}>
                          {m.role === 'assistant' && (
                            <div className="flex items-center gap-1 mb-1 text-xs opacity-70">
                              <MessageCircle className="h-3 w-3" /> IA
                            </div>
                          )}
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" /> Consultando transcrição...
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="flex items-end gap-2 sticky bottom-0 bg-background pt-2">
                    <Textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                      placeholder="Pergunte algo sobre esta reunião..."
                      rows={2}
                      className="resize-none text-sm"
                      disabled={chatLoading}
                    />
                    <Button size="icon" onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()}>
                      {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="audit-original-placeholder" className="hidden">
              {session.audit_logs?.length ? (
                <div className="space-y-2">
                  {session.audit_logs.map(log => (
                    <div key={log.id} className="flex items-start gap-3 text-sm border-b pb-2">
                      <span className="text-muted-foreground shrink-0">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                      <div>
                        <span className="font-medium">{log.user_name || 'Sistema'}</span>
                        <span className="text-muted-foreground ml-1">— {log.action.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum registro de auditoria.</p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}