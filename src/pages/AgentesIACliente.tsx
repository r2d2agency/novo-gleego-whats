import { useState, useEffect, useRef, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useGlobalAgents, GlobalAgentForClient, GlobalAgentActivation, ScheduleWindow } from '@/hooks/use-global-agents';
import { useAIAgents } from '@/hooks/use-ai-agents';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
 import { Bot, Clock, Plug, Plus, Trash2, Settings, Loader2, Calendar, Key, MessageSquare, Send, Mic, Image, Brain, Sparkles, FileText, User, Scissors, RefreshCw, Package, Users, CreditCard, Save } from 'lucide-react';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

const CAPABILITY_ICONS: Record<string, { icon: typeof Bot; label: string }> = {
  respond_messages: { icon: MessageSquare, label: 'Responder mensagens' },
  transcribe_audio: { icon: Mic, label: 'Ouvir áudios' },
  analyze_images: { icon: Image, label: 'Analisar imagens' },
  read_files: { icon: FileText, label: 'Ler arquivos' },
  schedule_meetings: { icon: Calendar, label: 'Agendar reuniões' },
  generate_content: { icon: Sparkles, label: 'Gerar conteúdo' },
};

const TONE_OPTIONS = [
  { value: 'professional', label: 'Profissional' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
  { value: 'empathetic', label: 'Empático' },
  { value: 'persuasive', label: 'Persuasivo' },
];

const INTERNAL_CUSTOM_FIELDS = ['_voice_tone', '_voice_gender', '_custom_name', '_selected_model'] as const;

interface Connection {
  id: string;
  name: string;
  phone_number?: string;
  status: string;
  provider?: string;
}

interface TestMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const normalizeCustomFieldValues = (values: unknown): Record<string, string> => {
  let parsed = values;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    normalized[key] = typeof value === 'string' ? value : String(value);
  }

  return normalized;
};

const normalizeScheduleWindows = (windows: unknown): ScheduleWindow[] => {
  let parsed = windows;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((window): ScheduleWindow | null => {
      if (!window || typeof window !== 'object') return null;
      const raw = window as Record<string, unknown>;

      return {
        days: Array.isArray(raw.days)
          ? raw.days.filter((day): day is number => typeof day === 'number' && day >= 0 && day <= 6)
          : [],
        start: typeof raw.start === 'string' ? raw.start : '08:00',
        end: typeof raw.end === 'string' ? raw.end : '18:00',
      };
    })
    .filter((window): window is ScheduleWindow => Boolean(window));
};

type ActivationSettings = {
  scheduleMode: 'always' | 'scheduled' | 'manual';
  scheduleWindows: ScheduleWindow[];
  customFieldValues: Record<string, string>;
  customName: string;
  voiceTone: string;
  voiceGender: 'female' | 'male';
   selectedModel: string;
   appbarberApiKey: string;
   appbarberEstablishmentCode: string;
};

const extractActivationSettings = (activation?: GlobalAgentActivation | null): ActivationSettings => {
  const normalizedFields = normalizeCustomFieldValues(activation?.custom_field_values);
  const visibleCustomFields: Record<string, string> = {};

  for (const [key, value] of Object.entries(normalizedFields)) {
    if (!INTERNAL_CUSTOM_FIELDS.includes(key as typeof INTERNAL_CUSTOM_FIELDS[number])) {
      visibleCustomFields[key] = value;
    }
  }

  const tone = normalizedFields._voice_tone;
  const gender = normalizedFields._voice_gender;

  return {
    scheduleMode: (activation?.schedule_mode as 'always' | 'scheduled' | 'manual') || 'manual',
    scheduleWindows: normalizeScheduleWindows(activation?.schedule_windows),
    customFieldValues: visibleCustomFields,
    customName: normalizedFields._custom_name || '',
    voiceTone: TONE_OPTIONS.some((option) => option.value === tone) ? tone : 'professional',
    voiceGender: gender === 'male' ? 'male' : 'female',
     selectedModel: normalizedFields._selected_model || '',
     appbarberApiKey: normalizedFields._appbarber_api_key || '',
     appbarberEstablishmentCode: normalizedFields._appbarber_establishment_code || '',
  };
};

export default function AgentesIACliente() {
  const { user } = useAuth();
  const { loading, getAvailableAgents, activateAgent, updateActivation, deactivateAgent, deleteActivation, getAIModels, testAgent } = useGlobalAgents();
  const [agents, setAgents] = useState<GlobalAgentForClient[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [aiModels, setAiModels] = useState<Record<string, { id: string; name: string; description: string }[]>>({});
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<GlobalAgentForClient | null>(null);
  const [selectedActivation, setSelectedActivation] = useState<GlobalAgentActivation | null>(null);
  
  // Form state
  const [selectedConnection, setSelectedConnection] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'always' | 'scheduled' | 'manual'>('manual');
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [promptAdditions, setPromptAdditions] = useState('');
  const [clientAiApiKey, setClientAiApiKey] = useState('');
  const [customName, setCustomName] = useState('');
  const [voiceTone, setVoiceTone] = useState('professional');
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');
   const [selectedModel, setSelectedModel] = useState('');
   const [appbarberApiKey, setAppbarberApiKey] = useState('');
   const [appbarberEstablishmentCode, setAppbarberEstablishmentCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTestSettings, setShowTestSettings] = useState(false);
  // Test chat state
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testAgentData, setTestAgentData] = useState<GlobalAgentForClient | null>(null);
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testInput, setTestInput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role && ['owner', 'admin', 'manager'].includes(user.role);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [testMessages]);

  const loadData = async () => {
    const [agentsData, modelsData, orgScopedConns, assignedConns, orgDirectConns] = await Promise.all([
      getAvailableAgents(),
      getAIModels(),
      api<Connection[]>('/api/connections', { auth: true }).catch(() => []),
      api<Connection[]>('/api/connections', { auth: true }).catch(() => []),
      user?.organization_id
        ? api<Connection[]>(`/api/organizations/${user.organization_id}/connections`, { auth: true }).catch(() => [])
        : Promise.resolve([] as Connection[]),
    ]);

    const normalizedAgents = (agentsData || []).map((agent) => ({
      ...agent,
      activations: (agent.activations || []).map((activation) => ({
        ...activation,
        schedule_mode: (activation.schedule_mode as 'always' | 'scheduled' | 'manual') || 'manual',
        schedule_windows: normalizeScheduleWindows(activation.schedule_windows),
        custom_field_values: normalizeCustomFieldValues(activation.custom_field_values),
      })),
    }));

    const mergedConnectionsMap = new Map<string, Connection>();
    [...orgScopedConns, ...assignedConns, ...orgDirectConns].forEach((conn) => {
      mergedConnectionsMap.set(conn.id, conn);
    });

    // Garante que conexões já ativadas continuem selecionáveis mesmo se alguma API falhar
    normalizedAgents.forEach((agent) => {
      agent.activations.forEach((activation) => {
        if (!activation.connection_id || mergedConnectionsMap.has(activation.connection_id)) return;

        mergedConnectionsMap.set(activation.connection_id, {
          id: activation.connection_id,
          name: activation.connection_name || `Conexão vinculada (${activation.connection_id.slice(0, 8)})`,
          phone_number: activation.connection_phone,
          status: 'disconnected',
        });
      });
    });

    setAgents(normalizedAgents);
    setConnections(Array.from(mergedConnectionsMap.values()));
    setAiModels(modelsData);
  };

  const handleOpenConfig = (agent: GlobalAgentForClient, activation?: GlobalAgentActivation) => {
    const settings = extractActivationSettings(activation);

    setSelectedAgent(agent);
    setSelectedActivation(activation || null);
    setSelectedConnection(activation?.connection_id || '');
    setScheduleMode(settings.scheduleMode);
    setScheduleWindows(settings.scheduleWindows);
    setCustomFieldValues(settings.customFieldValues);
    setPromptAdditions(activation?.prompt_additions || '');
    setClientAiApiKey(activation?.client_ai_api_key ? '***' : '');
    setCustomName(settings.customName);
    setVoiceTone(settings.voiceTone);
     setVoiceGender(settings.voiceGender);
     setSelectedModel(settings.selectedModel || agent.ai_model || '');
     setAppbarberApiKey(settings.appbarberApiKey || agent.appbarber_api_key || '');
     setAppbarberEstablishmentCode(settings.appbarberEstablishmentCode || agent.appbarber_establishment_code || '');
    // Reset test messages for inline test tab
    setTestMessages([{
      id: 'welcome',
      role: 'system',
      content: `Ambiente de teste do agente "${agent.name}". Envie uma mensagem para testar.`
    }]);
    setTestInput('');
    setConfigDialogOpen(true);
  };

  const handleAddWindow = () => {
    setScheduleWindows([...scheduleWindows, { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }]);
  };

  const handleRemoveWindow = (index: number) => {
    setScheduleWindows(scheduleWindows.filter((_, i) => i !== index));
  };

  const handleUpdateWindow = (index: number, field: keyof ScheduleWindow, value: any) => {
    const updated = [...scheduleWindows];
    updated[index] = { ...updated[index], [field]: value };
    setScheduleWindows(updated);
  };

  const toggleDay = (windowIndex: number, day: number) => {
    const updated = [...scheduleWindows];
    const days = updated[windowIndex].days;
    if (days.includes(day)) {
      updated[windowIndex] = { ...updated[windowIndex], days: days.filter(d => d !== day) };
    } else {
      updated[windowIndex] = { ...updated[windowIndex], days: [...days, day].sort() };
    }
    setScheduleWindows(updated);
  };

  const handleSave = async () => {
    if (!selectedAgent) return;
    if (!selectedConnection) {
      toast.error('Selecione uma conexão');
      return;
    }

    setSaving(true);
    try {
      const normalizedCustomName = customName.trim();
      const normalizedSelectedModel = selectedModel?.trim();
      const customFieldPayload: Record<string, string> = {
        ...customFieldValues,
         _voice_tone: voiceTone,
         _voice_gender: voiceGender,
         _appbarber_api_key: appbarberApiKey,
         _appbarber_establishment_code: appbarberEstablishmentCode,
      };

      if (normalizedCustomName) customFieldPayload._custom_name = normalizedCustomName;
      if (normalizedSelectedModel && !normalizedSelectedModel.startsWith('_label_')) {
        customFieldPayload._selected_model = normalizedSelectedModel;
      }

      const payload: any = {
        schedule_mode: scheduleMode,
        schedule_windows: scheduleWindows,
        custom_field_values: customFieldPayload,
        prompt_additions: promptAdditions,
      };

      const keepingMaskedApiKey = selectedActivation && clientAiApiKey === '***';
      if (!keepingMaskedApiKey) {
        const normalizedApiKey = clientAiApiKey.trim();
        payload.client_ai_api_key = normalizedApiKey || null;
      }

      if (selectedActivation) {
        const updated = await updateActivation(selectedActivation.id, payload);
        if (!updated) throw new Error('Não foi possível atualizar a configuração.');
        toast.success('Configuração atualizada!');
      } else {
        const activated = await activateAgent({
          global_agent_id: selectedAgent.id,
          connection_id: selectedConnection,
          ...payload,
        });
        if (!activated) throw new Error('Não foi possível ativar o agente.');
        toast.success('Agente ativado!');
      }

      await loadData();
      setConfigDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActivation = async (activation: GlobalAgentActivation) => {
    if (activation.is_active) {
      const success = await deactivateAgent(activation.id);
      if (success) {
        toast.success('Agente desativado');
        loadData();
      }
    } else {
      await updateActivation(activation.id, { is_active: true } as any);
      toast.success('Agente ativado');
      loadData();
    }
  };

  const handleDeleteActivation = async (activationId: string) => {
    const success = await deleteActivation(activationId);
    if (success) {
      toast.success('Configuração removida');
      loadData();
    }
  };

  const getConnectionName = (connId: string) => {
    const conn = connections.find(c => c.id === connId);
    return conn ? `${conn.name} (${conn.phone_number || ''})` : connId;
  };

  const getScheduleLabel = (mode: string, windows: ScheduleWindow[]) => {
    if (mode === 'always') return 'Sempre ativo';
    if (mode === 'manual') return 'Manual';
    if (mode === 'scheduled' && windows.length > 0) return `${windows.length} janela(s) de horário`;
    return 'Sem horários';
  };

  // Build tone/gender instructions for test
  const buildPersonalizationPrompt = () => {
    const parts: string[] = [];
    if (voiceTone && voiceTone !== 'professional') {
      const toneLabel = TONE_OPTIONS.find(t => t.value === voiceTone)?.label || voiceTone;
      parts.push(`Use um tom de voz ${toneLabel.toLowerCase()}.`);
    }
    if (voiceGender === 'male') {
      parts.push('Você é um assistente masculino. Use linguagem no gênero masculino.');
    } else {
      parts.push('Você é uma assistente feminina. Use linguagem no gênero feminino.');
    }
    return parts.join(' ');
  };

  // Test chat functions
  const handleOpenTest = (agent: GlobalAgentForClient) => {
    setTestAgentData(agent);
    setTestMessages([{
      id: 'welcome',
      role: 'system',
      content: `Ambiente de teste do agente "${agent.name}". Envie uma mensagem para testar a IA antes de vincular a uma conexão.`
    }]);
    setTestInput('');
    setCustomName('');
    setVoiceTone('professional');
    setVoiceGender('female');
    setSelectedModel(agent.ai_model || '');
    setClientAiApiKey('');
    setTestDialogOpen(true);
  };

  const handleSendTest = async () => {
    const input = testInput.trim();
    if (!input || testLoading) return;
    
    const agentData = testDialogOpen ? testAgentData : selectedAgent;
    if (!agentData) return;
    
    const userMsg: TestMessage = { id: `u-${Date.now()}`, role: 'user', content: input };
    setTestMessages(prev => [...prev, userMsg]);
    setTestInput('');
    setTestLoading(true);

    try {
      const history = testMessages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
      const personalization = buildPersonalizationPrompt();
      const fullPromptAdditions = [promptAdditions, personalization].filter(Boolean).join('\n\n');
      const normalizedApiKey = clientAiApiKey.trim();
      const keepingMaskedApiKey = normalizedApiKey === '***' || normalizedApiKey.startsWith('••');
      
      const result = await testAgent(agentData.id, {
        message: userMsg.content,
        history,
        client_ai_api_key: keepingMaskedApiKey ? undefined : (normalizedApiKey || undefined),
        custom_name: customName || undefined,
        prompt_additions: fullPromptAdditions || undefined,
        selected_model: selectedModel || undefined,
        activation_id: selectedActivation?.id || undefined,
        connection_id: selectedConnection || selectedActivation?.connection_id || undefined,
      });
      setTestMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.response,
      }]);
    } catch (err: any) {
      const errorMsg = err.message || 'Falha ao obter resposta';
      toast.error(errorMsg);
      setTestMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'system',
        content: `❌ Erro: ${errorMsg}`,
      }]);
    } finally {
      setTestLoading(false);
    }
  };

  // All available models from both providers
  const allModels = [
    ...(aiModels.openai || []).map(m => ({ ...m, provider: 'openai' as const })),
    ...(aiModels.gemini || []).map(m => ({ ...m, provider: 'gemini' as const })),
  ];

  if (loading && agents.length === 0) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // Shared test chat UI component
  const renderTestChat = () => (
    <div className="border rounded-lg h-64 flex flex-col">
      <ScrollArea className="flex-1 p-3">
        {testMessages.map(msg => (
          <div key={msg.id} className={`mb-2 ${msg.role === 'user' ? 'text-right' : ''}`}>
            <span className={`inline-block px-3 py-1.5 rounded-lg text-sm max-w-[85%] ${
              msg.role === 'user' ? 'bg-primary text-primary-foreground' :
              msg.role === 'system' ? 'bg-muted text-muted-foreground text-xs italic' :
              'bg-card border text-card-foreground'
            }`}>
              {msg.content}
            </span>
          </div>
        ))}
        {testLoading && (
          <div className="mb-2">
            <span className="inline-block px-3 py-1.5 rounded-lg bg-card border text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline" /> Pensando...
            </span>
          </div>
        )}
        <div ref={chatEndRef} />
      </ScrollArea>
      <div className="border-t p-2 flex gap-2">
        <Input
          placeholder="Digite uma mensagem de teste..."
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendTest();
            }
          }}
          disabled={testLoading}
          className="text-sm"
        />
        <Button size="icon" onClick={handleSendTest} disabled={testLoading || !testInput.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // Shared personalization fields
  const renderPersonalizationFields = (compact = false) => (
    <div className="space-y-4">
      {/* Custom AI Name */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Nome da IA</Label>
        <Input
          placeholder={`Ex: Sofia, Assistente Virtual, ${selectedAgent?.name || 'Lia'}...`}
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          className="text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Como a IA vai se apresentar ao cliente.
        </p>
      </div>

      {/* Voice Gender */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Gênero da voz</Label>
        <RadioGroup value={voiceGender} onValueChange={(v) => setVoiceGender(v as 'female' | 'male')} className="flex gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="female" id="gender-female" />
            <Label htmlFor="gender-female" className="text-sm cursor-pointer flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Feminino
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="male" id="gender-male" />
            <Label htmlFor="gender-male" className="text-sm cursor-pointer flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Masculino
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Voice Tone */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Tom de voz</Label>
        <Select value={voiceTone} onValueChange={setVoiceTone}>
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model Selection */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Modelo de IA</Label>
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Modelo padrão do agente" />
          </SelectTrigger>
          <SelectContent>
            {allModels.length > 0 ? (
              <>
                {(aiModels.openai || []).length > 0 && (
                  <>
                    <SelectItem value="_label_openai" disabled>— OpenAI —</SelectItem>
                    {(aiModels.openai || []).map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — {m.description}
                      </SelectItem>
                    ))}
                  </>
                )}
                {(aiModels.gemini || []).length > 0 && (
                  <>
                    <SelectItem value="_label_gemini" disabled>— Gemini —</SelectItem>
                    {(aiModels.gemini || []).map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — {m.description}
                      </SelectItem>
                    ))}
                  </>
                )}
              </>
            ) : (
              <SelectItem value="__loading" disabled>Carregando modelos...</SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Se vazio, usará o modelo padrão do agente ({selectedAgent?.ai_model || testAgentData?.ai_model || 'não definido'}).
        </p>
      </div>

      {!compact && (
        <div className="space-y-1.5">
          <Label className="text-xs">Instruções adicionais para a IA</Label>
          <Textarea
            placeholder="Ex: Sempre mencione nosso horário de atendimento, foque em vender o plano premium..."
            value={promptAdditions}
            onChange={(e) => setPromptAdditions(e.target.value)}
            rows={3}
          />
        </div>
      )}
    </div>
  );

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Bot className="h-8 w-8 text-primary" />
            Agentes IA
          </h1>
          <p className="text-muted-foreground">
            Gerencie os agentes de IA disponíveis para suas conexões
          </p>
        </div>

        {agents.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">Nenhum agente disponível</h3>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Nenhum agente de IA foi disponibilizado para sua organização ainda.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {agents.map(agent => (
              <Card key={agent.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {agent.avatar_url ? (
                        <img src={agent.avatar_url} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        {agent.description && (
                          <CardDescription className="text-xs mt-0.5">{agent.description}</CardDescription>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {agent.ai_provider && (
                      <Badge variant="outline" className="text-[10px] h-5">
                        {agent.ai_provider === 'openai' ? 'OpenAI' : agent.ai_provider === 'gemini' ? 'Gemini' : 'OpenRouter'} — {agent.ai_model}
                      </Badge>
                    )}
                    {agent.has_knowledge_base && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center">
                              <Brain className="h-3 w-3" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>Base de conhecimento ativa</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <TooltipProvider>
                      {(agent.capabilities || []).filter(c => CAPABILITY_ICONS[c]).map(cap => {
                        const info = CAPABILITY_ICONS[cap];
                        const Icon = info.icon;
                        return (
                          <Tooltip key={cap}>
                            <TooltipTrigger>
                              <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center">
                                <Icon className="h-3 w-3" />
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{info.label}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </TooltipProvider>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  {agent.activations.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Conexões ativas:</Label>
                      {agent.activations.map(act => (
                        <div key={act.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 border">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{getConnectionName(act.connection_id)}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge variant={act.is_active ? 'default' : 'secondary'} className="text-[10px] h-4 px-1">
                                {act.is_active ? 'Ativo' : 'Inativo'}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {getScheduleLabel(act.schedule_mode, act.schedule_windows)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={act.is_active}
                              onCheckedChange={() => handleToggleActivation(act)}
                              className="scale-75"
                            />
                            {isAdmin && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleOpenConfig(agent, act)}
                                >
                                  <Settings className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => handleDeleteActivation(act.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => handleOpenTest(agent)}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Testar IA
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => handleOpenConfig(agent)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Ativar em Conexão
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Config Dialog */}
        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>
                {selectedActivation ? 'Configurar Agente' : 'Ativar Agente'} — {selectedAgent?.name}
              </DialogTitle>
              <DialogDescription>
                Configure os horários e personalize o agente para sua conexão
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="connection" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid grid-cols-5 shrink-0">
                <TabsTrigger value="connection" className="gap-1 text-xs">
                  <Plug className="h-3.5 w-3.5" />
                  Conexão
                </TabsTrigger>
                <TabsTrigger value="schedule" className="gap-1 text-xs">
                  <Clock className="h-3.5 w-3.5" />
                  Horários
                </TabsTrigger>
                <TabsTrigger value="customize" className="gap-1 text-xs">
                  <Settings className="h-3.5 w-3.5" />
                  Personalizar
                </TabsTrigger>
                <TabsTrigger value="apikey" className="gap-1 text-xs">
                  <Key className="h-3.5 w-3.5" />
                  API Key
                </TabsTrigger>
                 <TabsTrigger value="test" className="gap-1 text-xs">
                   <MessageSquare className="h-3.5 w-3.5" />
                   Testar
                 </TabsTrigger>
                 {selectedAgent?.capabilities?.includes('appbarber') && (
                   <TabsTrigger value="appbarber" className="gap-1 text-xs">
                     <Scissors className="h-3.5 w-3.5" />
                     AppBarber
                   </TabsTrigger>
                 )}
              </TabsList>
                 {/* AppBarber Tab */}
                 <TabsContent value="appbarber" className="m-0 space-y-4">
                   <div className="space-y-4">
                     <div className="flex items-center gap-2">
                       <Scissors className="h-4 w-4 text-primary" />
                       <h4 className="font-medium text-sm">Integração AppBarber</h4>
                     </div>
                     <p className="text-xs text-muted-foreground">
                       Configure suas credenciais do AppBarber para habilitar agendamentos automáticos.
                     </p>
 
                     <div className="space-y-3">
                       <div className="space-y-1.5">
                         <Label className="text-xs font-medium">API Key</Label>
                         <Input
                           type="password"
                           placeholder="Sua API Key do AppBarber"
                           value={appbarberApiKey}
                           onChange={(e) => setAppbarberApiKey(e.target.value)}
                           className="text-sm"
                         />
                       </div>
                       <div className="space-y-1.5">
                         <Label className="text-xs font-medium">Código do Estabelecimento</Label>
                         <Input
                           placeholder="Código do seu estabelecimento"
                           value={appbarberEstablishmentCode}
                           onChange={(e) => setAppbarberEstablishmentCode(e.target.value)}
                           className="text-sm"
                         />
                       </div>
                     </div>
 
                      {selectedActivation ? (
                        <AppBarberActivationSection 
                          activationId={selectedActivation.id} 
                          credentials={{
                            appbarber_api_key: appbarberApiKey,
                            appbarber_establishment_code: appbarberEstablishmentCode
                          }}
                        />
                      ) : (
                        <p className="text-xs text-amber-500 bg-amber-50 p-2 rounded border border-amber-200">
                          ⚠️ Ative o agente primeiro para gerenciar serviços e profissionais.
                        </p>
                      )}
                   </div>
                 </TabsContent>

              <div className="flex-1 overflow-y-auto mt-4 space-y-4">
                {/* Connection Tab */}
                <TabsContent value="connection" className="m-0 space-y-4">
                  <div className="space-y-2">
                    <Label>Conexão WhatsApp *</Label>
                    <Select value={selectedConnection} onValueChange={setSelectedConnection} disabled={!!selectedActivation}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma conexão" />
                      </SelectTrigger>
                      <SelectContent>
                        {connections.map(conn => (
                          <SelectItem key={conn.id} value={conn.id}>
                            {conn.name} {conn.phone_number ? `(${conn.phone_number})` : ''} 
                            {conn.status !== 'connected' ? ' ⚠️' : ' ✅'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Modo de ativação</Label>
                    <Select value={scheduleMode} onValueChange={(v: any) => setScheduleMode(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="always">Sempre ativo (24/7)</SelectItem>
                        <SelectItem value="scheduled">Por horário</SelectItem>
                        <SelectItem value="manual">Manual (ligar/desligar)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {scheduleMode === 'always' && 'O agente responde a qualquer hora, todos os dias.'}
                      {scheduleMode === 'scheduled' && 'O agente só responde dentro das janelas de horário configuradas.'}
                      {scheduleMode === 'manual' && 'Controle manualmente quando o agente está ativo.'}
                    </p>
                  </div>
                </TabsContent>

                {/* Schedule Tab */}
                <TabsContent value="schedule" className="m-0 space-y-4">
                  {scheduleMode !== 'scheduled' ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Selecione o modo "Por horário" na aba Conexão para configurar janelas.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center">
                        <Label>Janelas de horário</Label>
                        <Button variant="outline" size="sm" onClick={handleAddWindow} className="gap-1.5">
                          <Plus className="h-3.5 w-3.5" />
                          Adicionar Janela
                        </Button>
                      </div>

                      {scheduleWindows.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Nenhuma janela configurada. Adicione pelo menos uma.
                        </p>
                      )}

                      {scheduleWindows.map((window, idx) => (
                        <Card key={idx} className="p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <Label className="text-sm font-medium">Janela {idx + 1}</Label>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => handleRemoveWindow(idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Dias da semana</Label>
                            <div className="flex gap-1 flex-wrap">
                              {DAYS_OF_WEEK.map(day => (
                                <Button
                                  key={day.value}
                                  variant={window.days.includes(day.value) ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 w-10 text-xs px-0"
                                  onClick={() => toggleDay(idx, day.value)}
                                >
                                  {day.label}
                                </Button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Início</Label>
                              <Input
                                type="time"
                                value={window.start}
                                onChange={(e) => handleUpdateWindow(idx, 'start', e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Fim</Label>
                              <Input
                                type="time"
                                value={window.end}
                                onChange={(e) => handleUpdateWindow(idx, 'end', e.target.value)}
                              />
                            </div>
                          </div>
                        </Card>
                      ))}

                      {scheduleWindows.length > 0 && (
                        <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                          <p className="font-medium">Resumo:</p>
                          {scheduleWindows.map((w, i) => (
                            <p key={i}>
                              Janela {i + 1}: {w.days.map(d => DAYS_OF_WEEK.find(dw => dw.value === d)?.label).join(', ')} — {w.start} às {w.end}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>

                {/* Customize Tab */}
                <TabsContent value="customize" className="m-0 space-y-4">
                  {renderPersonalizationFields()}

                  {selectedAgent?.custom_fields && selectedAgent.custom_fields.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Informações da sua empresa</Label>
                      {selectedAgent.custom_fields.map(field => (
                        <div key={field.key} className="space-y-1.5">
                          <Label className="text-xs">
                            {field.label} {field.required && <span className="text-destructive">*</span>}
                          </Label>
                          {field.type === 'textarea' ? (
                            <Textarea
                              placeholder={field.placeholder || ''}
                              value={customFieldValues[field.key] || ''}
                              onChange={(e) => setCustomFieldValues({ ...customFieldValues, [field.key]: e.target.value })}
                              rows={3}
                            />
                          ) : field.type === 'select' ? (
                            <Select
                              value={customFieldValues[field.key] || ''}
                              onValueChange={(v) => setCustomFieldValues({ ...customFieldValues, [field.key]: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={field.placeholder || 'Selecione'} />
                              </SelectTrigger>
                              <SelectContent>
                                {(field.options || []).map(opt => (
                                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              placeholder={field.placeholder || ''}
                              value={customFieldValues[field.key] || ''}
                              onChange={(e) => setCustomFieldValues({ ...customFieldValues, [field.key]: e.target.value })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* API Key Tab */}
                <TabsContent value="apikey" className="m-0 space-y-4">
                  <Card className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Key className="h-5 w-5 text-muted-foreground" />
                      <Label className="text-sm font-medium">Chave de API da IA</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Informe sua chave de API do provedor de IA (OpenAI ou Google Gemini). 
                      Se não informar, será usada a chave padrão do sistema (se disponível).
                    </p>
                    <Input
                      type="password"
                      placeholder="sk-... ou AIza..."
                      value={clientAiApiKey}
                      onChange={(e) => setClientAiApiKey(e.target.value)}
                    />

                    <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1.5">
                      <p className="font-medium">Como obter sua chave:</p>
                      <p>• <strong>OpenAI:</strong> Acesse platform.openai.com → API Keys</p>
                      <p>• <strong>Google Gemini:</strong> Acesse aistudio.google.com → Get API Key</p>
                      <p className="mt-2 text-[11px]">Sua chave é armazenada de forma segura e usada apenas para este agente.</p>
                    </div>
                  </Card>
                </TabsContent>

                {/* Test Tab (inline in config dialog) */}
                <TabsContent value="test" className="m-0 space-y-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                    <p>Teste a IA com suas configurações atuais (nome, tom, gênero, modelo, instruções, API key).</p>
                  </div>
                  {renderTestChat()}
                </TabsContent>
             </div>
           </Tabs>
 
           <DialogFooter className="shrink-0 pt-4 border-t">
             <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>Cancelar</Button>
             <Button onClick={handleSave} disabled={saving}>
               {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
               {selectedActivation ? 'Salvar' : 'Ativar Agente'}
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
 
        {/* Standalone Test Chat Dialog - Clean chat-first interface */}
        <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
          <DialogContent className="sm:max-w-2xl h-[85vh] flex flex-col p-0" aria-describedby="test-dialog-desc">
            <DialogHeader className="p-4 pb-3 border-b shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    Testar — {testAgentData?.name}
                  </DialogTitle>
                  <DialogDescription id="test-dialog-desc" className="text-xs mt-1">
                    Valide a IA antes de vincular a uma conexão
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTestSettings(prev => !prev)}
                    className="gap-1.5 text-xs"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Configurar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTestMessages([{
                        id: 'welcome',
                        role: 'system',
                        content: `Chat reiniciado. Envie uma nova mensagem para testar "${testAgentData?.name}".`
                      }]);
                    }}
                    className="gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Resetar
                  </Button>
                </div>
              </div>

              {/* Collapsible settings panel */}
              {showTestSettings && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome da IA</Label>
                      <Input
                        placeholder="Ex: Sofia"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tom de voz</Label>
                      <Select value={voiceTone} onValueChange={setVoiceTone}>
                        <SelectTrigger className="text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TONE_OPTIONS.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Gênero</Label>
                      <Select value={voiceGender} onValueChange={(v) => setVoiceGender(v as 'female' | 'male')}>
                        <SelectTrigger className="text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="female">Feminino</SelectItem>
                          <SelectItem value="male">Masculino</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Modelo</Label>
                      <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <SelectTrigger className="text-sm h-8">
                          <SelectValue placeholder="Padrão do agente" />
                        </SelectTrigger>
                        <SelectContent>
                          {(aiModels.openai || []).length > 0 && (
                            <>
                              <SelectItem value="_label_openai" disabled>— OpenAI —</SelectItem>
                              {(aiModels.openai || []).map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                              ))}
                            </>
                          )}
                          {(aiModels.gemini || []).length > 0 && (
                            <>
                              <SelectItem value="_label_gemini" disabled>— Gemini —</SelectItem>
                              {(aiModels.gemini || []).map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="space-y-1">
                      <Label className="text-xs">API Key (opcional)</Label>
                      <Input
                        type="password"
                        placeholder="sk-... ou AIza..."
                        value={clientAiApiKey}
                        onChange={(e) => setClientAiApiKey(e.target.value)}
                        className="text-sm h-8"
                        autoComplete="off"
                      />
                    </div>
                  </form>
                </div>
              )}
            </DialogHeader>

            {/* Chat messages area */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {testMessages.map(msg => (
                  <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role !== 'user' && (
                      <div className={`p-1.5 rounded-lg shrink-0 ${msg.role === 'system' ? 'bg-muted' : 'bg-primary/10'}`}>
                        {msg.role === 'system' ? (
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Bot className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user' ? 'bg-primary text-primary-foreground' :
                      msg.role === 'system' ? 'bg-muted text-muted-foreground text-xs italic' :
                      'bg-card border text-card-foreground'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                    )}
                  </div>
                ))}
                {testLoading && (
                  <div className="flex gap-2.5">
                    <div className="p-1.5 rounded-lg bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-card border rounded-lg px-3 py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>

            {/* Input area */}
            <div className="p-3 border-t shrink-0">
              <div className="flex gap-2">
                <Input
                  placeholder="Digite uma mensagem..."
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendTest();
                    }
                  }}
                  disabled={testLoading}
                  className="flex-1"
                  autoFocus
                />
                <Button onClick={handleSendTest} disabled={testLoading || !testInput.trim()}>
                  {testLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}

function AppBarberActivationSection({ activationId, credentials }: { activationId: string; credentials: { appbarber_api_key: string; appbarber_establishment_code: string } }) {
  const { 
    getAppBarberServices, 
    syncAppBarberServices, 
    saveAppBarberService,
    getAppBarberProfessionals, 
    syncAppBarberProfessionals,
    saveAppBarberProfessional
  } = useAIAgents();
  const [services, setServices] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [s, p] = await Promise.all([
      getAppBarberServices(activationId),
      getAppBarberProfessionals(activationId)
    ]);
    setServices(s);
    setProfessionals(p);
  }, [activationId, getAppBarberServices, getAppBarberProfessionals]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSyncServices = async () => {
    setSyncing(true);
    try {
      await syncAppBarberServices(activationId, { ...credentials, type: 1 });
      toast.success('Serviços sincronizados');
      loadData();
    } catch (err: any) { toast.error(err.message); }
    finally { setSyncing(false); }
  };

  const handleSyncProfessionals = async () => {
    setSyncing(true);
    try {
      await syncAppBarberProfessionals(activationId, credentials);
      toast.success('Profissionais sincronizados');
      loadData();
    } catch (err: any) { toast.error(err.message); }
    finally { setSyncing(false); }
  };

  const handleToggleService = async (service: any) => {
    setToggling(`service-${service.id}`);
    try {
      await saveAppBarberService(activationId, {
        ...service,
        is_active: !service.is_active
      });
      loadData();
    } catch (err: any) { toast.error(err.message); }
    finally { setToggling(null); }
  };

  const handleToggleProfessional = async (prof: any) => {
    setToggling(`prof-${prof.id}`);
    try {
      await saveAppBarberProfessional(activationId, {
        ...prof,
        is_active: !prof.is_active
      });
      loadData();
    } catch (err: any) { toast.error(err.message); }
    finally { setToggling(null); }
  };

  return (
    <div className="space-y-6 border-t pt-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <h4 className="font-medium text-sm">Serviços e Produtos Local ({services.length})</h4>
          </div>
          <Button size="sm" variant="outline" onClick={handleSyncServices} disabled={syncing}>
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} /> Sincronizar
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Código</TableHead>
                <TableHead className="text-xs">Descrição</TableHead>
                <TableHead className="text-xs">Valor</TableHead>
                <TableHead className="text-xs text-right">Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">
                    Nenhum serviço sincronizado.
                  </TableCell>
                </TableRow>
              ) : (
                services.map(s => (
                  <TableRow key={s.id} className="text-xs">
                    <TableCell className="font-mono">{s.service_code}</TableCell>
                    <TableCell className="font-medium">{s.service_description}</TableCell>
                    <TableCell>R$ {parseFloat(s.service_value || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Switch 
                        checked={s.is_active} 
                        disabled={toggling === `service-${s.id}`}
                        onCheckedChange={() => handleToggleService(s)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h4 className="font-medium text-sm">Profissionais ({professionals.length})</h4>
          </div>
          <Button size="sm" variant="outline" onClick={handleSyncProfessionals} disabled={syncing}>
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} /> Sincronizar
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">Código</TableHead>
                <TableHead className="text-xs">Nome</TableHead>
                <TableHead className="text-xs">Apelido</TableHead>
                <TableHead className="text-xs text-right">Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {professionals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">
                    Nenhum profissional sincronizado.
                  </TableCell>
                </TableRow>
              ) : (
                professionals.map(p => (
                  <TableRow key={p.id} className="text-xs">
                    <TableCell className="font-mono">{p.employee_code}</TableCell>
                    <TableCell className="font-medium">{p.employee_name}</TableCell>
                    <TableCell>{p.employee_nickname || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Switch 
                        checked={p.is_active} 
                        disabled={toggling === `prof-${p.id}`}
                        onCheckedChange={() => handleToggleProfessional(p)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      
      <p className="text-[10px] text-muted-foreground italic">
        * A IA usará apenas os itens marcados como ativos para responder clientes e realizar agendamentos.
      </p>
    </div>
  );
}
