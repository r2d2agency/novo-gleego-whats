import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bot, Brain, MessageSquare, Settings, Zap, Shield,
  Sparkles, X, Plus, Save, Loader2, Phone, BellRing, CalendarDays, Scissors,
  RefreshCw, Trash2, Package, CheckCircle2, XCircle, ShieldCheck, Users, CreditCard
} from 'lucide-react';
import { useAIAgents, AIAgent, AgentCapability, AIModels, CallAgentConfig, CallAgentRule, AppBarberService, AppBarberProfessional, AppBarberPaymentType } from '@/hooks/use-ai-agents';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface AgentEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AIAgent | null;
  onSaved: () => void;
}

const ALL_CAPABILITIES: { id: AgentCapability; label: string; description: string }[] = [
  { id: 'respond_messages', label: 'Responder Mensagens', description: 'Responde automaticamente baseado no contexto' },
  { id: 'transcribe_audio', label: 'Ouvir Áudios', description: 'Transcreve e entende mensagens de áudio/voz' },
  { id: 'analyze_images', label: 'Analisar Imagens', description: 'Interpreta imagens recebidas com contexto multimodal' },
  { id: 'read_files', label: 'Ler Arquivos', description: 'Lê e interpreta documentos (PDF, DOC, planilhas e textos)' },
  { id: 'schedule_meetings', label: 'Agendar Reuniões', description: 'Integra com calendário para marcar compromissos' },
  { id: 'google_calendar', label: 'Google Calendar', description: 'Gerencia eventos: criar, editar, remover reuniões' },
  { id: 'manage_tasks', label: 'Gerenciar Tarefas', description: 'Cria e atualiza tarefas com responsável definido' },
  { id: 'create_deals', label: 'Criar Negociações', description: 'Cria deals automaticamente no CRM' },
  { id: 'suggest_actions', label: 'Sugerir Ações', description: 'Analisa e sugere próximos passos' },
  { id: 'generate_content', label: 'Gerar Conteúdo', description: 'Cria rascunhos de emails e mensagens' },
  { id: 'summarize_history', label: 'Resumir Histórico', description: 'Resume interações anteriores com o cliente' },
  { id: 'qualify_leads', label: 'Qualificar Leads', description: 'Scoring automático baseado em dados' },
  { id: 'call_agent', label: 'Chamar Outro Agente', description: 'Consulta outro agente especialista para informações' },
  { id: 'appbarber', label: 'AppBarber (Agendamento)', description: 'Integra com AppBarber para consultar serviços, horários e agendar clientes' },
];

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente virtual profissional e prestativo. Seu objetivo é ajudar os clientes de forma clara, objetiva e amigável.

Diretrizes:
- Seja cordial e use uma linguagem acessível
- Responda de forma concisa, mas completa
- Se não souber algo, admita e ofereça alternativas
- Quando apropriado, faça perguntas para entender melhor a necessidade
- Mantenha o foco no atendimento ao cliente`;

// Helper to normalize PostgreSQL arrays (can come as string "{a,b,c}" or actual array)
function normalizeArray<T>(value: unknown, defaultValue: T[] = []): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    // PostgreSQL array format: {item1,item2,item3}
    if (value.startsWith('{') && value.endsWith('}')) {
      const inner = value.slice(1, -1);
      if (!inner) return defaultValue;
      return inner.split(',').map(s => s.trim()) as T[];
    }
    // Try JSON parse
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : defaultValue;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

// Helper to normalize numeric fields from PostgreSQL (may come as strings)
function normalizeNumber(value: unknown, defaultValue: number): number {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

export function AgentEditorDialog({ open, onOpenChange, agent, onSaved }: AgentEditorDialogProps) {
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<AIModels>({ openai: [], gemini: [] });
  const [handoffKeyword, setHandoffKeyword] = useState('');
  const [availableAgents, setAvailableAgents] = useState<AIAgent[]>([]);
  const { user } = useAuth();

  const { data: orgMembers } = useQuery({
    queryKey: ['org-members', user?.organization_id],
    queryFn: () => api<Array<{ user_id: string; name: string; email: string; role: string }>>(`/api/organizations/${user?.organization_id}/members`),
    enabled: !!user?.organization_id,
  });

  const { data: orgDepartments } = useQuery({
    queryKey: ['org-departments', user?.organization_id],
    queryFn: () => api<Array<{ id: string; name: string }>>(`/api/organizations/${user?.organization_id}/departments`),
    enabled: !!user?.organization_id,
  });

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    avatar_url: '',
    ai_provider: 'openai' as 'openai' | 'gemini' | 'openrouter',
    ai_model: 'gpt-4o-mini',
    ai_api_key: '',
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    personality_traits: [] as string[],
    language: 'pt-BR',
    temperature: 0.7,
    max_tokens: 1000,
    context_window: 10,
    capabilities: ['respond_messages'] as AgentCapability[],
    greeting_message: '',
    fallback_message: 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
    handoff_message: 'Vou transferir você para um atendente humano.',
    handoff_keywords: ['humano', 'atendente', 'pessoa'] as string[],
    auto_handoff_after_failures: 3,
    takeover_timeout_seconds: 300,
    required_variables: [] as Array<{ name: string; question: string }>,
    inactivity_timeout_minutes: 0,
    inactivity_message: 'Como não recebi sua resposta, vou encerrar nosso atendimento por aqui. Se precisar, é só me chamar novamente! 😊',
    call_agent_config: { allow_all: true, allowed_agent_ids: [], rules: [] } as CallAgentConfig,
    notify_external_enabled: false,
    notify_external_phone: '',
    notify_external_summary: true,
    default_user_id: '' as string,
    default_department_id: '' as string,
    appbarber_api_key: '',
    appbarber_establishment_code: '',
  });

  const { createAgent, updateAgent, getAIModels, getAgents } = useAIAgents();

  const defaultCallAgentConfig: CallAgentConfig = { allow_all: true, allowed_agent_ids: [], rules: [] };

  useEffect(() => {
    if (open) {
      loadModels();
      loadAvailableAgents();
      if (agent && agent.id) {
        const parsedConfig = typeof agent.call_agent_config === 'string'
          ? JSON.parse(agent.call_agent_config || '{}')
          : (agent.call_agent_config || {});
        setFormData({
          name: agent.name,
          description: agent.description || '',
          avatar_url: agent.avatar_url || '',
          ai_provider: agent.ai_provider,
          ai_model: agent.ai_model,
          ai_api_key: '',
          system_prompt: agent.system_prompt,
          personality_traits: normalizeArray<string>(agent.personality_traits, []),
          language: agent.language,
          temperature: normalizeNumber(agent.temperature, 0.7),
          max_tokens: normalizeNumber(agent.max_tokens, 1000),
          context_window: normalizeNumber(agent.context_window, 10),
          capabilities: normalizeArray<AgentCapability>(agent.capabilities, ['respond_messages']),
          greeting_message: agent.greeting_message || '',
          fallback_message: agent.fallback_message,
          handoff_message: agent.handoff_message,
          handoff_keywords: normalizeArray<string>(agent.handoff_keywords, ['humano', 'atendente', 'pessoa']),
          auto_handoff_after_failures: normalizeNumber(agent.auto_handoff_after_failures, 3),
          takeover_timeout_seconds: normalizeNumber((agent as any).takeover_timeout_seconds, 300),
          required_variables: Array.isArray((agent as any).required_variables) ? (agent as any).required_variables : [],
          inactivity_timeout_minutes: normalizeNumber((agent as any).inactivity_timeout_minutes, 0),
          inactivity_message: (agent as any).inactivity_message || 'Como não recebi sua resposta, vou encerrar nosso atendimento por aqui. Se precisar, é só me chamar novamente! 😊',
          call_agent_config: { ...defaultCallAgentConfig, ...parsedConfig },
          notify_external_enabled: (agent as any).notify_external_enabled || false,
          notify_external_phone: (agent as any).notify_external_phone || '',
          notify_external_summary: (agent as any).notify_external_summary !== false,
          default_user_id: agent.default_user_id || '',
          default_department_id: agent.default_department_id || '',
          appbarber_api_key: agent.appbarber_api_key || '',
          appbarber_establishment_code: agent.appbarber_establishment_code || '',
        });
      } else {
        setFormData({
          name: agent?.name || '',
          description: agent?.description || '',
          avatar_url: '',
          ai_provider: 'openai',
          ai_model: 'gpt-4o-mini',
          ai_api_key: '',
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          personality_traits: [],
          language: 'pt-BR',
          temperature: 0.7,
          max_tokens: 1000,
          context_window: 10,
          capabilities: ['respond_messages'],
          greeting_message: '',
          fallback_message: 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
          handoff_message: 'Vou transferir você para um atendente humano.',
          handoff_keywords: ['humano', 'atendente', 'pessoa'],
          auto_handoff_after_failures: 3,
          takeover_timeout_seconds: 300,
          required_variables: [],
          inactivity_timeout_minutes: 0,
          inactivity_message: 'Como não recebi sua resposta, vou encerrar nosso atendimento por aqui. Se precisar, é só me chamar novamente! 😊',
          call_agent_config: defaultCallAgentConfig,
          notify_external_enabled: false,
          notify_external_phone: '',
          notify_external_summary: true,
          default_user_id: '',
          default_department_id: '',
          appbarber_api_key: '',
          appbarber_establishment_code: '',
        });
      }
    }
  }, [open, agent]);

  const loadModels = async () => {
    const data = await getAIModels();
    setModels(data);
  };

  const loadAvailableAgents = async () => {
    const agents = await getAgents();
    // Exclude current agent from the list
    setAvailableAgents(agents.filter(a => a.id !== agent?.id));
  };

  const toggleAllowedAgent = (agentId: string) => {
    setFormData(prev => {
      const current = prev.call_agent_config.allowed_agent_ids || [];
      const updated = current.includes(agentId)
        ? current.filter(id => id !== agentId)
        : [...current, agentId];
      return {
        ...prev,
        call_agent_config: { ...prev.call_agent_config, allowed_agent_ids: updated },
      };
    });
  };

  const updateAgentRule = (agentId: string, field: string, value: string) => {
    setFormData(prev => {
      const rules = [...(prev.call_agent_config.rules || [])];
      const idx = rules.findIndex(r => r.agent_id === agentId);
      if (idx >= 0) {
        rules[idx] = { ...rules[idx], [field]: value };
      } else {
        const agentInfo = availableAgents.find(a => a.id === agentId);
        rules.push({ agent_id: agentId, agent_name: agentInfo?.name || '', trigger: 'auto', [field]: value } as CallAgentRule);
      }
      return {
        ...prev,
        call_agent_config: { ...prev.call_agent_config, rules },
      };
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        ai_api_key: formData.ai_api_key || undefined, // Não enviar se vazio
      };

      const savedAgent = agent?.id
        ? await updateAgent(agent.id, payload)
        : await createAgent(payload);

      if (!savedAgent) {
        throw new Error(agent?.id ? 'Não foi possível salvar as alterações do agente.' : 'Não foi possível criar o agente.');
      }

      toast.success(agent?.id ? 'Agente atualizado' : 'Agente criado');
      onSaved();
     } catch (err) {
       const msg = err instanceof Error && err.message ? err.message : 'Erro ao salvar agente';
       toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleCapability = (cap: AgentCapability) => {
    setFormData(prev => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter(c => c !== cap)
        : [...prev.capabilities, cap]
    }));
  };

  const addHandoffKeyword = () => {
    if (handoffKeyword.trim() && !formData.handoff_keywords.includes(handoffKeyword.trim())) {
      setFormData(prev => ({
        ...prev,
        handoff_keywords: [...prev.handoff_keywords, handoffKeyword.trim()]
      }));
      setHandoffKeyword('');
    }
  };

  const removeHandoffKeyword = (keyword: string) => {
    setFormData(prev => ({
      ...prev,
      handoff_keywords: prev.handoff_keywords.filter(k => k !== keyword)
    }));
  };

  const currentModels = formData.ai_provider === 'openai' ? models.openai : formData.ai_provider === 'gemini' ? models.gemini : (models as any).openrouter || models.openai;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {agent?.id ? 'Editar Agente' : 'Novo Agente de IA'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configurações do agente de IA
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1">
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic" className="gap-2">
                <Bot className="h-4 w-4" />
                Básico
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-2">
                <Brain className="h-4 w-4" />
                IA
              </TabsTrigger>
              <TabsTrigger value="capabilities" className="gap-2">
                <Zap className="h-4 w-4" />
                Capacidades
              </TabsTrigger>
              <TabsTrigger value="handoff" className="gap-2">
                <Shield className="h-4 w-4" />
                Handoff
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 h-[calc(90vh-220px)]">
            <div className="p-6 pt-4 pb-24">
              {/* Basic Tab */}
              <TabsContent value="basic" className="space-y-4 mt-0">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Nome do Agente *</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Assistente de Vendas"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="description">Descrição</Label>
                    <Textarea
                      id="description"
                      placeholder="Descreva o propósito do agente..."
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="greeting">Mensagem de Boas-vindas</Label>
                    <Textarea
                      id="greeting"
                      placeholder="Olá! Como posso ajudar você hoje?"
                      value={formData.greeting_message}
                      onChange={(e) => setFormData(prev => ({ ...prev, greeting_message: e.target.value }))}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enviada automaticamente ao iniciar uma conversa
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="fallback">Mensagem de Fallback</Label>
                    <Textarea
                      id="fallback"
                      value={formData.fallback_message}
                      onChange={(e) => setFormData(prev => ({ ...prev, fallback_message: e.target.value }))}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Usada quando o agente não consegue entender a mensagem
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* AI Tab */}
              <TabsContent value="ai" className="space-y-4 mt-0">
                <div className="grid gap-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Provedor de IA</Label>
                      <Select
                        value={formData.ai_provider}
                        onValueChange={(value: 'openai' | 'gemini' | 'openrouter') => {
                          const defaultModel = value === 'openai' ? 'gpt-4o-mini' : value === 'gemini' ? 'gemini-2.5-flash' : 'openai/gpt-4o-mini';
                          setFormData(prev => ({
                            ...prev,
                            ai_provider: value,
                            ai_model: defaultModel
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-green-500" />
                              OpenAI
                            </div>
                          </SelectItem>
                          <SelectItem value="gemini">
                            <div className="flex items-center gap-2">
                              <Brain className="h-4 w-4 text-blue-500" />
                              Google Gemini
                            </div>
                          </SelectItem>
                          <SelectItem value="openrouter">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-purple-500" />
                              OpenRouter
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label>Modelo</Label>
                      <Select
                        value={formData.ai_model}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, ai_model: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {currentModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              <div>
                                <p>{model.name}</p>
                                <p className="text-xs text-muted-foreground">{model.description}</p>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="apiKey">Chave de API do agente (opcional)</Label>
                    <Input
                      id="apiKey"
                      type="password"
                      placeholder="Deixe vazio para usar a chave da organização"
                      value={formData.ai_api_key}
                      onChange={(e) => setFormData(prev => ({ ...prev, ai_api_key: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use uma chave específica só para este agente. Se deixar vazio, o sistema usa automaticamente a chave configurada em Ajustes → IA da organização.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="system_prompt">System Prompt</Label>
                    <Textarea
                      id="system_prompt"
                      value={formData.system_prompt}
                      onChange={(e) => setFormData(prev => ({ ...prev, system_prompt: e.target.value }))}
                      rows={8}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Define a personalidade e comportamento base do agente
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="grid gap-2">
                      <Label>Temperatura: {normalizeNumber(formData.temperature, 0.7).toFixed(1)}</Label>
                      <Slider
                        value={[normalizeNumber(formData.temperature, 0.7)]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, temperature: value }))}
                        min={0}
                        max={1}
                        step={0.1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Menor = mais focado, Maior = mais criativo
                      </p>
                    </div>

                    <div className="grid gap-2">
                      <Label>Max Tokens: {normalizeNumber(formData.max_tokens, 1000)}</Label>
                      <Slider
                        value={[normalizeNumber(formData.max_tokens, 1000)]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, max_tokens: value }))}
                        min={100}
                        max={4000}
                        step={100}
                      />
                      <p className="text-xs text-muted-foreground">
                        Tamanho máximo da resposta
                      </p>
                    </div>

                    <div className="grid gap-2">
                      <Label>Contexto: {normalizeNumber(formData.context_window, 10)} msgs</Label>
                      <Slider
                        value={[normalizeNumber(formData.context_window, 10)]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, context_window: value }))}
                        min={1}
                        max={20}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Mensagens anteriores incluídas
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Capabilities Tab */}
              <TabsContent value="capabilities" className="space-y-2 mt-0">
                <div className="grid gap-2">
                  {ALL_CAPABILITIES.map((cap) => (
                    <div
                      key={cap.id}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        formData.capabilities.includes(cap.id)
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-muted-foreground/50'
                      }`}
                      onClick={() => toggleCapability(cap.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{cap.label}</p>
                        <p className="text-xs text-muted-foreground">{cap.description}</p>
                      </div>
                      <Switch
                        checked={formData.capabilities.includes(cap.id)}
                        onCheckedChange={() => toggleCapability(cap.id)}
                      />
                    </div>
                  ))}
                </div>

                {/* Schedule User Selector - shown when schedule_meetings or google_calendar is enabled */}
                {(formData.capabilities.includes('schedule_meetings') || formData.capabilities.includes('google_calendar')) && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <h4 className="font-medium text-sm">Responsável da Agenda</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Selecione o usuário cuja agenda a IA irá consultar e onde serão criados os compromissos. Funciona independente do Google Calendar estar conectado.
                    </p>
                    <Select
                      value={formData.default_user_id || ''}
                      onValueChange={(v) => setFormData(prev => ({ ...prev, default_user_id: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o responsável..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(orgMembers || []).map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.name} ({m.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!formData.default_user_id && (
                      <p className="text-xs text-amber-500">
                        ⚠️ Sem responsável definido, a IA usará o criador do agente como padrão.
                      </p>
                    )}
                  </div>
                )}

                {/* AppBarber Configuration */}
                {formData.capabilities.includes('appbarber') && (
                  <AppBarberConfigSection
                    agentId={agent?.id || null}
                    formData={formData}
                    setFormData={setFormData}
                  />
                )}


                {formData.capabilities.includes('call_agent') && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <h4 className="font-medium text-sm">Configuração: Chamar Outro Agente</h4>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium text-sm">Permitir todos os agentes</p>
                        <p className="text-xs text-muted-foreground">A IA decide automaticamente qual agente consultar</p>
                      </div>
                      <Switch
                        checked={formData.call_agent_config.allow_all ?? true}
                        onCheckedChange={(v) => setFormData(prev => ({
                          ...prev,
                          call_agent_config: { ...prev.call_agent_config, allow_all: v },
                        }))}
                      />
                    </div>

                    {!formData.call_agent_config.allow_all && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Selecione quais agentes podem ser consultados e defina quando:</p>
                        {availableAgents.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic p-3 border rounded-lg">
                            Nenhum outro agente disponível. Crie mais agentes para usar esta funcionalidade.
                          </p>
                        ) : (
                          availableAgents.map((ag) => {
                            const isSelected = (formData.call_agent_config.allowed_agent_ids || []).includes(ag.id);
                            const rule = (formData.call_agent_config.rules || []).find(r => r.agent_id === ag.id);
                            return (
                              <div key={ag.id} className={`rounded-lg border p-3 space-y-2 transition-colors ${isSelected ? 'border-primary bg-primary/5' : ''}`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm">{ag.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{ag.description || 'Sem descrição'}</p>
                                  </div>
                                  <Switch
                                    checked={isSelected}
                                    onCheckedChange={() => toggleAllowedAgent(ag.id)}
                                  />
                                </div>
                                {isSelected && (
                                  <div className="pt-2 border-t space-y-2">
                                    <div>
                                      <Label className="text-xs">Quando consultar este agente?</Label>
                                      <Input
                                        placeholder="Ex: Quando o cliente perguntar sobre questões jurídicas, contratos..."
                                        value={rule?.topic_description || ''}
                                        onChange={(e) => updateAgentRule(ag.id, 'topic_description', e.target.value)}
                                        className="mt-1 text-xs h-8"
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Descreva em quais situações a IA deve consultar este agente
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Handoff Tab */}
              <TabsContent value="handoff" className="space-y-4 mt-0">
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="default_user_id">Responsável Padrão</Label>
                      <Select
                        value={formData.default_user_id || 'none'}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, default_user_id: v === 'none' ? '' : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Ninguém (Fila Geral)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ninguém (Fila Geral)</SelectItem>
                          {(orgMembers || []).map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="default_department_id">Departamento Padrão</Label>
                      <Select
                        value={formData.default_department_id || 'none'}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, default_department_id: v === 'none' ? '' : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Nenhum (Todos os Agentes)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum (Todos os Agentes)</SelectItem>
                          {(orgDepartments || []).map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="handoff_message">Mensagem de Transferência</Label>
                    <Textarea
                      id="handoff_message"
                      value={formData.handoff_message}
                      onChange={(e) => setFormData(prev => ({ ...prev, handoff_message: e.target.value }))}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enviada quando o usuário é transferido para um humano
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label>Palavras-chave de Transferência</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Adicionar palavra-chave..."
                        value={handoffKeyword}
                        onChange={(e) => setHandoffKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHandoffKeyword())}
                      />
                      <Button type="button" variant="outline" onClick={addHandoffKeyword}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.handoff_keywords.map((keyword) => (
                        <Badge key={keyword} variant="secondary" className="gap-1">
                          {keyword}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => removeHandoffKeyword(keyword)}
                          />
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Quando o usuário menciona essas palavras, é transferido automaticamente
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label>Transferir após {formData.auto_handoff_after_failures} falhas</Label>
                    <Slider
                      value={[formData.auto_handoff_after_failures]}
                      onValueChange={([value]) => setFormData(prev => ({ ...prev, auto_handoff_after_failures: value }))}
                      min={1}
                      max={10}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Número de vezes que o agente pode falhar antes de transferir automaticamente
                    </p>
                  </div>

                  {/* Takeover Timeout */}
                  <div className="border-t pt-4 space-y-4">
                    <div className="grid gap-2">
                      <Label>Takeover (Assumir Controle) - {formData.takeover_timeout_seconds} segundos</Label>
                      <Slider
                        value={[formData.takeover_timeout_seconds]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, takeover_timeout_seconds: value }))}
                        min={30}
                        max={1800}
                        step={30}
                      />
                      <p className="text-xs text-muted-foreground">
                        Quando você responde pelo WhatsApp, o agente pausa por este tempo
                      </p>
                    </div>
                  </div>

                  {/* Required Variables */}
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <h4 className="font-medium text-sm">Variáveis Obrigatórias</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Configure quais informações a IA deve coletar obrigatoriamente antes de transferir. Se alguma estiver faltando, a IA perguntará ao cliente antes de transferir.
                    </p>

                    {formData.required_variables.map((variable, index) => (
                      <div key={index} className="flex gap-2 items-start p-3 rounded-lg border">
                        <div className="flex-1 space-y-2">
                          <Input
                            placeholder="Nome da variável"
                            value={variable.name}
                            onChange={(e) => {
                              const updated = [...formData.required_variables];
                              updated[index] = { ...updated[index], name: e.target.value };
                              setFormData(prev => ({ ...prev, required_variables: updated }));
                            }}
                            className="h-8 text-sm"
                          />
                          <Input
                            placeholder="Pergunta para coletar (ex: Qual o seu nome?)"
                            value={variable.question}
                            onChange={(e) => {
                              const updated = [...formData.required_variables];
                              updated[index] = { ...updated[index], question: e.target.value };
                              setFormData(prev => ({ ...prev, required_variables: updated }));
                            }}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              required_variables: prev.required_variables.filter((_, i) => i !== index),
                            }));
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          required_variables: [...prev.required_variables, { name: '', question: '' }],
                        }));
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Adicionar Variável
                    </Button>

                    <p className="text-xs text-muted-foreground italic">
                      💡 A IA vai coletar essas informações naturalmente durante a conversa. Antes de transferir, ela verificará se todas foram preenchidas e perguntará as que faltam.
                    </p>
                  </div>

                  {/* Inactivity Timeout */}
                  <div className="border-t pt-4 space-y-4">
                    <div className="grid gap-2">
                      <Label>Timeout de Inatividade - {formData.inactivity_timeout_minutes} minutos</Label>
                      <Slider
                        value={[formData.inactivity_timeout_minutes]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, inactivity_timeout_minutes: value }))}
                        min={0}
                        max={120}
                        step={5}
                      />
                      <p className="text-xs text-muted-foreground">
                        Envia uma mensagem de encerramento se o usuário parar de responder. 0 = desabilitado.
                      </p>
                    </div>

                    {formData.inactivity_timeout_minutes > 0 && (
                      <div className="grid gap-2">
                        <Label htmlFor="inactivity_message">Mensagem de encerramento</Label>
                        <Textarea
                          id="inactivity_message"
                          value={formData.inactivity_message}
                          onChange={(e) => setFormData(prev => ({ ...prev, inactivity_message: e.target.value }))}
                          rows={2}
                        />
                      </div>
                    )}
                  </div>

                  {/* External Notification */}
                  <div className="border-t pt-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <BellRing className="h-4 w-4 text-primary" />
                      <h4 className="font-medium text-sm">Notificação Externa via WhatsApp</h4>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Ativar notificação externa</Label>
                        <p className="text-xs text-muted-foreground">
                          Envia um resumo do atendimento para um número externo
                        </p>
                      </div>
                      <Switch
                        checked={formData.notify_external_enabled}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, notify_external_enabled: v }))}
                      />
                    </div>

                    {formData.notify_external_enabled && (
                      <>
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            Número WhatsApp
                          </Label>
                          <Input
                            placeholder="5511999999999 (com DDI)"
                            value={formData.notify_external_phone}
                            onChange={(e) => setFormData(prev => ({ ...prev, notify_external_phone: e.target.value }))}
                          />
                          <p className="text-xs text-muted-foreground">
                            Número completo com DDI (ex: 5511999999999)
                          </p>
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Enviar resumo completo</Label>
                            <p className="text-xs text-muted-foreground">
                              Inclui a solicitação do cliente e resposta do agente
                            </p>
                          </div>
                          <Switch
                            checked={formData.notify_external_summary}
                            onCheckedChange={(v) => setFormData(prev => ({ ...prev, notify_external_summary: v }))}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        <div className="flex justify-end gap-3 p-6 pt-0 border-t mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Salvar Agente
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== APPBARBER CONFIG SECTION ====================

function AppBarberConfigSection({ agentId, formData, setFormData }: {
  agentId: string | null;
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const { getAppBarberServices, saveAppBarberService, deleteAppBarberService, syncAppBarberServices } = useAIAgents();
  const [services, setServices] = useState<AppBarberService[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [newService, setNewService] = useState({ service_code: '', service_description: '', service_value: '', service_interval: '30' });
  const [showAddForm, setShowAddForm] = useState(false);

  const loadServices = useCallback(async () => {
    if (!agentId) return;
    const data = await getAppBarberServices(agentId);
    setServices(data);
  }, [agentId, getAppBarberServices]);

  const handleValidateToken = async () => {
    const apiKey = String(formData.appbarber_api_key || '').trim();
    const establishmentCode = String(formData.appbarber_establishment_code || '').trim();

    if (!apiKey || !establishmentCode) {
      toast.error('Preencha a API Key e o código do estabelecimento.');
      return;
    }

    setValidating(true);
    setValidationResult('idle');
    try {
      const result = await api<{ ok: boolean; total?: number }>('/api/ai-agents/appbarber/validate', {
        method: 'POST',
        body: {
          appbarber_api_key: apiKey,
          appbarber_establishment_code: establishmentCode,
        },
        auth: true,
      });
      setValidationResult('valid');
      toast.success(`API Key válida! ${result.total ?? 0} serviço(s) encontrado(s).`);
    } catch (err) {
      setValidationResult('invalid');
      toast.error(err instanceof Error ? err.message : 'API Key inválida ou erro de conexão');
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    setValidationResult('idle');
  }, [formData.appbarber_api_key, formData.appbarber_establishment_code]);

  const handleSync = async () => {
    if (!agentId) return;
    setSyncing(true);
    try {
      const result = await syncAppBarberServices(agentId, {
        appbarber_api_key: String(formData.appbarber_api_key || '').trim(),
        appbarber_establishment_code: String(formData.appbarber_establishment_code || '').trim(),
        type: 1,
      });

      if (!result?.imported) {
        toast.warning('Nenhum serviço encontrado na API AppBarber.');
        setSyncing(false);
        return;
      }

      const failed = Math.max((result.total ?? result.imported) - result.imported, 0);
      toast.success(
        failed > 0
          ? `${result.imported} serviços importados (${failed} falharam)`
          : `${result.imported} serviços importados com sucesso`
      );

      await loadServices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao sincronizar serviços');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddService = async () => {
    if (!agentId || !newService.service_code || !newService.service_description) return;
    const saved = await saveAppBarberService(agentId, {
      service_code: parseInt(newService.service_code),
      service_description: newService.service_description,
      service_value: parseFloat(newService.service_value) || 0,
      service_interval: parseInt(newService.service_interval) || 30,
    });
    if (saved) {
      toast.success('Serviço adicionado');
      setNewService({ service_code: '', service_description: '', service_value: '', service_interval: '30' });
      setShowAddForm(false);
      loadServices();
    }
  };

  const handleDelete = async (serviceId: string) => {
    if (!agentId) return;
    await deleteAppBarberService(agentId, serviceId);
    toast.success('Serviço removido');
    loadServices();
  };

  const handleToggle = async (service: AppBarberService) => {
    if (!agentId) return;
    await saveAppBarberService(agentId, {
      service_code: service.service_code,
      service_description: service.service_description,
      service_value: service.service_value,
      service_interval: service.service_interval,
      is_active: !service.is_active,
    });
    loadServices();
  };

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Scissors className="h-4 w-4 text-primary" />
        <h4 className="font-medium text-sm">Integração AppBarber</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure as credenciais e gerencie os serviços localmente para reduzir chamadas à API.
      </p>

      {/* Credentials */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs">API Key</Label>
          <Input
            type="password"
            value={formData.appbarber_api_key}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, appbarber_api_key: e.target.value }))}
            placeholder="Ex: ec03cbd6-0c41-4a0e-..."
            className="text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Código do Estabelecimento</Label>
          <Input
            value={formData.appbarber_establishment_code}
            onChange={(e) => setFormData((prev: any) => ({ ...prev, appbarber_establishment_code: e.target.value }))}
            placeholder="Ex: 21951279"
            className="text-sm"
          />
        </div>
      </div>

      {/* Validate Button */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={validationResult === 'valid' ? 'default' : validationResult === 'invalid' ? 'destructive' : 'outline'}
          onClick={handleValidateToken}
          disabled={validating || !formData.appbarber_api_key || !formData.appbarber_establishment_code}
          className="text-xs h-8"
        >
          {validating ? (
            <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Validando...</>
          ) : validationResult === 'valid' ? (
            <><CheckCircle2 className="h-3 w-3 mr-1" />Token Válido</>
          ) : validationResult === 'invalid' ? (
            <><XCircle className="h-3 w-3 mr-1" />Token Inválido</>
          ) : (
            <><ShieldCheck className="h-3 w-3 mr-1" />Validar API Key</>
          )}
        </Button>
        {validationResult === 'valid' && (
          <span className="text-xs text-green-600">✓ Conexão verificada</span>
        )}
        {validationResult === 'invalid' && (
          <span className="text-xs text-destructive">✗ Verifique as credenciais</span>
        )}
      </div>
      {agentId && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">Serviços Cadastrados</h4>
              <Badge variant="secondary" className="text-xs">{services.length}</Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="text-xs h-7">
                <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                Sincronizar da API
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)} className="text-xs h-7">
                <Plus className="h-3 w-3 mr-1" />
                Adicionar
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            💡 Serviços são consultados localmente (sem custo). Apenas disponibilidade e agendamento usam a API.
          </p>

          {/* Add form */}
          {showAddForm && (
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input
                    type="number"
                    value={newService.service_code}
                    onChange={(e) => setNewService(prev => ({ ...prev, service_code: e.target.value }))}
                    placeholder="Ex: 101"
                    className="text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Descrição</Label>
                  <Input
                    value={newService.service_description}
                    onChange={(e) => setNewService(prev => ({ ...prev, service_description: e.target.value }))}
                    placeholder="Ex: Corte Masculino"
                    className="text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newService.service_value}
                    onChange={(e) => setNewService(prev => ({ ...prev, service_value: e.target.value }))}
                    placeholder="45.00"
                    className="text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Duração (min)</Label>
                  <Input
                    type="number"
                    value={newService.service_interval}
                    onChange={(e) => setNewService(prev => ({ ...prev, service_interval: e.target.value }))}
                    placeholder="30"
                    className="text-sm h-8"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="text-xs h-7">Cancelar</Button>
                <Button size="sm" onClick={handleAddService} className="text-xs h-7">
                  <Save className="h-3 w-3 mr-1" />
                  Salvar
                </Button>
              </div>
            </div>
          )}

          {/* Services list */}
          {services.length > 0 ? (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {services.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                  <div className="flex items-center gap-3 flex-1">
                    <Switch
                      checked={s.is_active}
                      onCheckedChange={() => handleToggle(s)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                        {s.service_description}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        (cód: {s.service_code})
                      </span>
                    </div>
                    <span className="text-xs font-medium text-primary">
                      R$ {Number(s.service_value).toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.service_interval}min
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)} className="h-7 w-7 p-0 ml-2">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-muted-foreground border rounded-lg">
              Nenhum serviço cadastrado. Use "Sincronizar da API" para importar ou adicione manualmente.
            </div>
          )}
        </div>
      )}

      {!agentId && (
        <p className="text-xs text-amber-500">
          ⚠️ Salve o agente primeiro para gerenciar os serviços.
        </p>
      )}

      {agentId && (
        <>
          <AppBarberProfessionalsSection agentId={agentId} formData={formData} />
          <AppBarberPaymentTypesSection agentId={agentId} formData={formData} />
        </>
      )}
    </div>
  );
}

// ==================== APPBARBER PROFESSIONALS SECTION ====================

function AppBarberProfessionalsSection({ agentId, formData }: { agentId: string; formData: any }) {
  const { getAppBarberProfessionals, saveAppBarberProfessional, deleteAppBarberProfessional, syncAppBarberProfessionals } = useAIAgents();
  const [items, setItems] = useState<AppBarberProfessional[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ employee_code: '', employee_name: '', employee_nickname: '' });

  const load = useCallback(async () => {
    const data = await getAppBarberProfessionals(agentId);
    setItems(data);
  }, [agentId, getAppBarberProfessionals]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAppBarberProfessionals(agentId, {
        appbarber_api_key: String(formData.appbarber_api_key || '').trim(),
        appbarber_establishment_code: String(formData.appbarber_establishment_code || '').trim(),
      });
      if (!result?.imported) {
        toast.warning('Nenhum profissional encontrado na API AppBarber.');
      } else {
        toast.success(`${result.imported} profissional(is) importado(s)`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao sincronizar profissionais');
    } finally {
      setSyncing(false);
    }
  };

  const handleAdd = async () => {
    if (!newItem.employee_code || !newItem.employee_name) return;
    const saved = await saveAppBarberProfessional(agentId, {
      employee_code: parseInt(newItem.employee_code, 10),
      employee_name: newItem.employee_name,
      employee_nickname: newItem.employee_nickname || null,
    });
    if (saved) {
      toast.success('Profissional adicionado');
      setNewItem({ employee_code: '', employee_name: '', employee_nickname: '' });
      setShowAdd(false);
      load();
    }
  };

  const handleDelete = async (id: string) => {
    await deleteAppBarberProfessional(agentId, id);
    toast.success('Profissional removido');
    load();
  };

  const handleToggle = async (item: AppBarberProfessional) => {
    await saveAppBarberProfessional(agentId, {
      employee_code: item.employee_code,
      employee_name: item.employee_name,
      employee_nickname: item.employee_nickname,
      is_active: !item.is_active,
    });
    load();
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h4 className="font-medium text-sm">Profissionais Cadastrados</h4>
          <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="text-xs h-7">
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar da API
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Adicionar
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        💡 Profissionais são consultados localmente (sem custo de API).
      </p>

      {showAdd && (
        <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Código</Label>
              <Input type="number" value={newItem.employee_code} onChange={(e) => setNewItem(p => ({ ...p, employee_code: e.target.value }))} className="text-sm h-8" placeholder="42" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Nome</Label>
              <Input value={newItem.employee_name} onChange={(e) => setNewItem(p => ({ ...p, employee_name: e.target.value }))} className="text-sm h-8" placeholder="João Silva" />
            </div>
            <div className="col-span-3">
              <Label className="text-xs">Apelido (opcional)</Label>
              <Input value={newItem.employee_nickname} onChange={(e) => setNewItem(p => ({ ...p, employee_nickname: e.target.value }))} className="text-sm h-8" placeholder="João" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="text-xs h-7">Cancelar</Button>
            <Button size="sm" onClick={handleAdd} className="text-xs h-7"><Save className="h-3 w-3 mr-1" />Salvar</Button>
          </div>
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {items.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
              <div className="flex items-center gap-3 flex-1">
                <Switch checked={p.is_active} onCheckedChange={() => handleToggle(p)} />
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${!p.is_active ? 'text-muted-foreground line-through' : ''}`}>{p.employee_name}</span>
                  {p.employee_nickname && <span className="text-xs text-muted-foreground ml-2">({p.employee_nickname})</span>}
                  <span className="text-xs text-muted-foreground ml-2">cód: {p.employee_code}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)} className="h-7 w-7 p-0 ml-2">
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-xs text-muted-foreground border rounded-lg">
          Nenhum profissional cadastrado. Use "Sincronizar da API" para importar.
        </div>
      )}
    </div>
  );
}

// ==================== APPBARBER PAYMENT TYPES SECTION ====================

function AppBarberPaymentTypesSection({ agentId, formData }: { agentId: string; formData: any }) {
  const { getAppBarberPaymentTypes, saveAppBarberPaymentType, deleteAppBarberPaymentType, syncAppBarberPaymentTypes } = useAIAgents();
  const [items, setItems] = useState<AppBarberPaymentType[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ payment_code: '', payment_description: '' });

  const load = useCallback(async () => {
    const data = await getAppBarberPaymentTypes(agentId);
    setItems(data);
  }, [agentId, getAppBarberPaymentTypes]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAppBarberPaymentTypes(agentId, {
        appbarber_api_key: String(formData.appbarber_api_key || '').trim(),
        appbarber_establishment_code: String(formData.appbarber_establishment_code || '').trim(),
      });
      if (!result?.imported) {
        toast.warning('Nenhum tipo de pagamento encontrado na API AppBarber.');
      } else {
        toast.success(`${result.imported} tipo(s) de pagamento importado(s)`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao sincronizar tipos de pagamento');
    } finally {
      setSyncing(false);
    }
  };

  const handleAdd = async () => {
    if (!newItem.payment_code || !newItem.payment_description) return;
    const saved = await saveAppBarberPaymentType(agentId, {
      payment_code: parseInt(newItem.payment_code, 10),
      payment_description: newItem.payment_description,
    });
    if (saved) {
      toast.success('Tipo de pagamento adicionado');
      setNewItem({ payment_code: '', payment_description: '' });
      setShowAdd(false);
      load();
    }
  };

  const handleDelete = async (id: string) => {
    await deleteAppBarberPaymentType(agentId, id);
    toast.success('Tipo de pagamento removido');
    load();
  };

  const handleToggle = async (item: AppBarberPaymentType) => {
    await saveAppBarberPaymentType(agentId, {
      payment_code: item.payment_code,
      payment_description: item.payment_description,
      is_active: !item.is_active,
    });
    load();
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h4 className="font-medium text-sm">Tipos de Pagamento</h4>
          <Badge variant="secondary" className="text-xs">{items.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="text-xs h-7">
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar da API
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" />
            Adicionar
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        💡 Formas de pagamento aceitas pela barbearia (consulta local, sem custo de API).
      </p>

      {showAdd && (
        <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Código</Label>
              <Input type="number" value={newItem.payment_code} onChange={(e) => setNewItem(p => ({ ...p, payment_code: e.target.value }))} className="text-sm h-8" placeholder="1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Descrição</Label>
              <Input value={newItem.payment_description} onChange={(e) => setNewItem(p => ({ ...p, payment_description: e.target.value }))} className="text-sm h-8" placeholder="PIX" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="text-xs h-7">Cancelar</Button>
            <Button size="sm" onClick={handleAdd} className="text-xs h-7"><Save className="h-3 w-3 mr-1" />Salvar</Button>
          </div>
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {items.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
              <div className="flex items-center gap-3 flex-1">
                <Switch checked={p.is_active} onCheckedChange={() => handleToggle(p)} />
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${!p.is_active ? 'text-muted-foreground line-through' : ''}`}>{p.payment_description}</span>
                  <span className="text-xs text-muted-foreground ml-2">cód: {p.payment_code}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)} className="h-7 w-7 p-0 ml-2">
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-xs text-muted-foreground border rounded-lg">
          Nenhum tipo de pagamento cadastrado. Use "Sincronizar da API" para importar.
        </div>
      )}
    </div>
  );
}
