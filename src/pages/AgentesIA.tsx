import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { 
  Bot, Plus, Search, Settings, Database, Zap, 
  MessageSquare, BarChart3, Trash2, Copy, MoreVertical,
  Brain, Globe, FileText, Sparkles, Loader2, Play, Activity
} from 'lucide-react';
import { useAIAgents, AIAgent, AIAgentRealtimeLog } from '@/hooks/use-ai-agents';
import { toast } from 'sonner';
import { AgentEditorDialog } from '@/components/ai-agents/AgentEditorDialog';
import { AgentStatsDialog } from '@/components/ai-agents/AgentStatsDialog';
import { KnowledgeBaseDialog } from '@/components/ai-agents/KnowledgeBaseDialog';
import { AgentTestChatDialog } from '@/components/ai-agents/AgentTestChatDialog';
import { API_URL, getAuthToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function AgentesIA() {
  const navigate = useNavigate();
  const { user, modulesEnabled, pagePermissions } = useAuth();
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsAgent, setStatsAgent] = useState<AIAgent | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeAgent, setKnowledgeAgent] = useState<AIAgent | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<AIAgent | null>(null);
  const [testChatOpen, setTestChatOpen] = useState(false);
  const [testChatAgent, setTestChatAgent] = useState<AIAgent | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [realtimeLogs, setRealtimeLogs] = useState<AIAgentRealtimeLog[]>([]);
  const [loadingRealtimeLogs, setLoadingRealtimeLogs] = useState(false);
  const [logAgentIdFilter, setLogAgentIdFilter] = useState('');

  const { getAgents, toggleAgent, deleteAgent, getRealtimeLogs, loading } = useAIAgents();

  // Check access: superadmin OR (plan has ai_agents module AND user has agentes_ia page permission)
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate('/dashboard');
      return;
    }
    if (user?.is_superadmin) {
      setIsSuperadmin(true);
      setCheckingAccess(false);
      return;
    }
    const hasModule = modulesEnabled?.ai_agents !== false;
    const hasPagePerm = !pagePermissions || pagePermissions.agentes_ia !== false;
    if (!hasModule) {
      toast.error('Seu plano não inclui Agentes IA');
      navigate('/dashboard');
      return;
    }
    if (!hasPagePerm) {
      toast.error('Você não tem permissão para acessar Agentes IA');
      navigate('/dashboard');
      return;
    }
    setCheckingAccess(false);
  }, [navigate, user, modulesEnabled, pagePermissions]);

  const loadAgents = async () => {
    const data = await getAgents();
    // Copilot e Auto-Resposta têm sua própria página (Agentes › Modos).
    // Aqui mostramos apenas os agentes "standard".
    setAgents((data || []).filter((a: any) => (a.agent_mode || 'standard') === 'standard'));
  };

  useEffect(() => {
    if (!checkingAccess) {
      loadAgents();
    }
  }, [checkingAccess]);

  useEffect(() => {
    if (!isSuperadmin) return;

    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadRealtime = async () => {
      if (!active) return;
      setLoadingRealtimeLogs(true);
      try {
        const logs = await getRealtimeLogs(120);
        if (active) setRealtimeLogs(logs);
      } finally {
        if (active) setLoadingRealtimeLogs(false);
      }
    };

    loadRealtime();
    intervalId = setInterval(loadRealtime, 3000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSuperadmin, getRealtimeLogs]);

  const handleToggle = async (agent: AIAgent) => {
    const result = await toggleAgent(agent.id);
    if (result) {
      setAgents(prev => prev.map(a => 
        a.id === agent.id ? { ...a, is_active: result.is_active } : a
      ));
      toast.success(result.is_active ? 'Agente ativado' : 'Agente desativado');
    }
  };

  const handleDelete = async () => {
    if (!agentToDelete) return;
    const success = await deleteAgent(agentToDelete.id);
    if (success) {
      setAgents(prev => prev.filter(a => a.id !== agentToDelete.id));
      toast.success('Agente excluído');
    }
    setDeleteDialogOpen(false);
    setAgentToDelete(null);
  };

  const handleDuplicate = (agent: AIAgent) => {
    setSelectedAgent({
      ...agent,
      id: '',
      name: `${agent.name} (Cópia)`,
    });
    setEditorOpen(true);
  };

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(search.toLowerCase()) ||
    agent.description?.toLowerCase().includes(search.toLowerCase())
  );

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai':
        return <Sparkles className="h-4 w-4 text-green-500" />;
      case 'gemini':
        return <Brain className="h-4 w-4 text-blue-500" />;
      default:
        return <Bot className="h-4 w-4" />;
    }
  };

  const getCapabilityLabel = (cap: string) => {
    const labels: Record<string, string> = {
      respond_messages: 'Responder',
      read_files: 'Ler Arquivos',
      analyze_images: 'Analisar Imagens',
      transcribe_audio: 'Ouvir Áudios',
      schedule_meetings: 'Agendar',
      google_calendar: 'Google Calendar',
      manage_tasks: 'Tarefas',
      create_deals: 'Criar Deals',
      suggest_actions: 'Sugestões',
      generate_content: 'Gerar Conteúdo',
      summarize_history: 'Resumir',
      qualify_leads: 'Qualificar',
      call_agent: 'Chamar Agente',
    };
    return labels[cap] || cap;
  };

  const parseLogCapabilities = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
    }

    return [trimmed.replace(/^"|"$/g, '')];
  };

  const filteredRealtimeLogs = realtimeLogs.filter((log) => {
    const filter = logAgentIdFilter.trim().toLowerCase();
    if (!filter) return true;
    const agentId = typeof log.agentId === 'string' ? log.agentId.toLowerCase() : '';
    return agentId.includes(filter);
  });

  // Show loading while checking access
  if (checkingAccess) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-7 w-7 text-primary" />
              Agentes de IA
            </h1>
            <p className="text-muted-foreground mt-1">
              Crie assistentes inteligentes com base de conhecimento personalizada
            </p>
          </div>
          <Button onClick={() => { setSelectedAgent(null); setEditorOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Agente
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{agents.length}</p>
                  <p className="text-sm text-muted-foreground">Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Zap className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {agents.filter(a => a.is_active).length}
                  </p>
                  <p className="text-sm text-muted-foreground">Ativos</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <MessageSquare className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {agents.reduce((sum, a) => sum + (a.active_sessions || 0), 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Sessões Ativas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Database className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {agents.reduce((sum, a) => sum + (a.knowledge_sources_count || 0), 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Fontes de Conhecimento</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar agentes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Painel de logs em tempo real */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Logs em tempo real da IA
              </span>
              <Badge variant="outline">Atualiza a cada 3s</Badge>
            </CardTitle>
            <CardDescription>
              Eventos de transcrição, RAG e tool calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-w-sm">
              <Input
                placeholder="Filtrar por agentId..."
                value={logAgentIdFilter}
                onChange={(e) => setLogAgentIdFilter(e.target.value)}
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/20">
              {loadingRealtimeLogs && realtimeLogs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando logs...</div>
              ) : filteredRealtimeLogs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {realtimeLogs.length === 0 ? 'Sem eventos recentes.' : 'Nenhum log para este agentId.'}
                </div>
              ) : (
                <div className="divide-y">
                  <div className="hidden md:grid md:grid-cols-6 gap-2 p-3 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30">
                    <span>Hora</span>
                    <span>Nível</span>
                    <span>Evento</span>
                    <span>AgentId</span>
                    <span>Capabilities</span>
                    <span>Detalhes</span>
                  </div>
                  {filteredRealtimeLogs.slice(0, 40).map((log, idx) => {
                    const caps = parseLogCapabilities(log.capabilities);
                    return (
                      <div key={`${log.ts}-${idx}`} className="p-3 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                          <span className="text-muted-foreground">{new Date(log.ts).toLocaleTimeString('pt-BR')}</span>
                          <div>
                            <Badge variant={log.level === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                              {log.level}
                            </Badge>
                          </div>
                          <p className="font-medium break-all">{log.event}</p>
                          <span className="break-all text-muted-foreground">{typeof log.agentId === 'string' ? log.agentId : '-'}</span>
                          <span className="break-all text-muted-foreground">{caps.length ? caps.join(', ') : '-'}</span>
                          <span className="break-all text-muted-foreground">
                            {log.provider ? `provider=${log.provider} ` : ''}
                            {log.messageType ? `tipo=${log.messageType} ` : ''}
                            {log.toolName ? `tool=${log.toolName}` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Agents Grid */}
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredAgents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {search ? 'Nenhum agente encontrado' : 'Nenhum agente criado'}
              </h3>
              <p className="text-muted-foreground text-center max-w-sm mb-4">
                {search 
                  ? 'Tente uma busca diferente'
                  : 'Crie seu primeiro agente de IA para automatizar atendimentos e processos'
                }
              </p>
              {!search && (
                <Button onClick={() => { setSelectedAgent(null); setEditorOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Agente
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => (
              <Card key={agent.id} className="group hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {agent.avatar_url ? (
                          <img 
                            src={agent.avatar_url} 
                            alt={agent.name}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Bot className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background ${
                          agent.is_active ? 'bg-green-500' : 'bg-gray-400'
                        }`} />
                      </div>
                      <div>
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {getProviderIcon(agent.ai_provider)}
                          <span className="text-xs text-muted-foreground">
                            {agent.ai_model}
                          </span>
                        </div>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setTestChatAgent(agent); setTestChatOpen(true); }}>
                          <Play className="h-4 w-4 mr-2" />
                          Testar Agente
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => { setSelectedAgent(agent); setEditorOpen(true); }}>
                          <Settings className="h-4 w-4 mr-2" />
                          Configurar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setKnowledgeAgent(agent); setKnowledgeOpen(true); }}>
                          <Database className="h-4 w-4 mr-2" />
                          Base de Conhecimento
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setStatsAgent(agent); setStatsOpen(true); }}>
                          <BarChart3 className="h-4 w-4 mr-2" />
                          Estatísticas
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDuplicate(agent)}>
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setAgentToDelete(agent); setDeleteDialogOpen(true); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {agent.description && (
                    <CardDescription className="line-clamp-2">
                      {agent.description}
                    </CardDescription>
                  )}

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1.5">
                    {(Array.isArray(agent.capabilities) ? agent.capabilities : []).slice(0, 4).map((cap) => (
                      <Badge key={cap} variant="secondary" className="text-xs">
                        {getCapabilityLabel(cap)}
                      </Badge>
                    ))}
                    {Array.isArray(agent.capabilities) && agent.capabilities.length > 4 && (
                      <Badge variant="outline" className="text-xs">
                        +{agent.capabilities.length - 4}
                      </Badge>
                    )}
                  </div>

                  {/* Stats Row */}
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Database className="h-3.5 w-3.5" />
                        {agent.knowledge_sources_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5" />
                        {agent.connections_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {agent.active_sessions || 0}
                      </span>
                    </div>
                    <Switch
                      checked={agent.is_active}
                      onCheckedChange={() => handleToggle(agent)}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AgentEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        agent={selectedAgent}
        onSaved={() => {
          loadAgents();
          setEditorOpen(false);
        }}
      />

      <AgentStatsDialog
        open={statsOpen}
        onOpenChange={setStatsOpen}
        agent={statsAgent}
      />

      <KnowledgeBaseDialog
        open={knowledgeOpen}
        onOpenChange={setKnowledgeOpen}
        agent={knowledgeAgent}
      />

      <AgentTestChatDialog
        open={testChatOpen}
        onOpenChange={setTestChatOpen}
        agent={testChatAgent}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o agente "{agentToDelete?.name}"? 
              Esta ação não pode ser desfeita e todas as configurações, 
              base de conhecimento e histórico serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
