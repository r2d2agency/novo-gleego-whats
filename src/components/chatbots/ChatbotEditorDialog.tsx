import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Bot, Save, Settings, MessageSquare, Clock, Sparkles, 
  Eye, EyeOff, Zap, AlertCircle, Loader2, List, Plus, Trash2, GripVertical
} from "lucide-react";
import { toast } from "sonner";
import { useChatbots, Chatbot, AIProvider, ChatbotMode, ChatbotType, MenuOption, AIModels } from "@/hooks/use-chatbots";
import { useDepartments, Department } from "@/hooks/use-departments";
import { useFlows, Flow } from "@/hooks/use-flows";
import { api } from "@/lib/api";

interface Connection {
  id: string;
  name: string;
  phone: string;
  status: string;
}

interface ChatbotEditorDialogProps {
  open: boolean;
  chatbot: Chatbot | null;
  onClose: (saved: boolean) => void;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

export function ChatbotEditorDialog({ open, chatbot, onClose }: ChatbotEditorDialogProps) {
  const { createChatbot, updateChatbot, getAIModels, loading } = useChatbots();
  const { getDepartments } = useDepartments();
  const { getFlows } = useFlows();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [aiModels, setAIModels] = useState<AIModels>({ gemini: [], openai: [] });
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    connection_id: '',
    is_active: false,
    chatbot_type: 'flow' as ChatbotType,
    mode: 'always' as ChatbotMode,
    business_hours_start: '08:00',
    business_hours_end: '18:00',
    business_days: [1, 2, 3, 4, 5] as number[],
    timezone: 'America/Sao_Paulo',
    ai_provider: 'none' as AIProvider,
    ai_model: '',
    ai_api_key: '',
    ai_system_prompt: '',
    ai_temperature: 0.7,
    ai_max_tokens: 500,
    welcome_message: '',
    fallback_message: 'Desculpe, não entendi. Vou transferir você para um atendente.',
    transfer_after_failures: 3,
    typing_delay_ms: 1500,
    // Menu tradicional
    menu_message: 'Olá! Escolha uma opção:\n\n1️⃣ Comercial\n2️⃣ Financeiro\n3️⃣ Suporte\n0️⃣ Falar com atendente',
    menu_options: [] as MenuOption[],
    invalid_option_message: 'Opção inválida. Por favor, digite um número válido.',
    // Fluxo visual
    linked_flow_id: '' as string,
  });

  useEffect(() => {
    if (open) {
      loadConnections();
      loadAIModels();
      loadDepartments();
      loadFlows();
      
      if (chatbot) {
        setFormData({
          name: chatbot.name,
          description: chatbot.description || '',
          connection_id: chatbot.connection_id || '',
          is_active: chatbot.is_active,
          chatbot_type: chatbot.chatbot_type || 'flow',
          mode: chatbot.mode,
          business_hours_start: chatbot.business_hours_start,
          business_hours_end: chatbot.business_hours_end,
          business_days: chatbot.business_days,
          timezone: chatbot.timezone,
          ai_provider: chatbot.ai_provider,
          ai_model: chatbot.ai_model || '',
          ai_api_key: chatbot.ai_api_key || '',
          ai_system_prompt: chatbot.ai_system_prompt || '',
          ai_temperature: chatbot.ai_temperature,
          ai_max_tokens: chatbot.ai_max_tokens,
          welcome_message: chatbot.welcome_message || '',
          fallback_message: chatbot.fallback_message,
          transfer_after_failures: chatbot.transfer_after_failures,
          typing_delay_ms: chatbot.typing_delay_ms,
          menu_message: chatbot.menu_message || 'Olá! Escolha uma opção:\n\n1️⃣ Comercial\n2️⃣ Financeiro\n3️⃣ Suporte\n0️⃣ Falar com atendente',
          menu_options: chatbot.menu_options || [],
          invalid_option_message: chatbot.invalid_option_message || 'Opção inválida. Por favor, digite um número válido.',
          linked_flow_id: (chatbot as any).linked_flow_id || '',
        });
      } else {
        // Reset form for new chatbot
        setFormData({
          name: '',
          description: '',
          connection_id: '',
          is_active: false,
          chatbot_type: 'flow',
          mode: 'always',
          business_hours_start: '08:00',
          business_hours_end: '18:00',
          business_days: [1, 2, 3, 4, 5],
          timezone: 'America/Sao_Paulo',
          ai_provider: 'none',
          ai_model: '',
          ai_api_key: '',
          ai_system_prompt: '',
          ai_temperature: 0.7,
          ai_max_tokens: 500,
          welcome_message: '',
          fallback_message: 'Desculpe, não entendi. Vou transferir você para um atendente.',
          transfer_after_failures: 3,
          typing_delay_ms: 1500,
          menu_message: 'Olá! Escolha uma opção:\n\n1️⃣ Comercial\n2️⃣ Financeiro\n3️⃣ Suporte\n0️⃣ Falar com atendente',
          menu_options: [],
          invalid_option_message: 'Opção inválida. Por favor, digite um número válido.',
          linked_flow_id: '',
        });
      }
    }
  }, [open, chatbot]);

  const loadConnections = async () => {
    try {
      const data = await api<Connection[]>('/api/connections', { auth: true });
      setConnections(data.filter(c => c.status === 'connected'));
    } catch (error) {
      console.error('Erro ao carregar conexões:', error);
    }
  };

  const loadAIModels = async () => {
    const models = await getAIModels();
    setAIModels(models);
  };

  const loadDepartments = async () => {
    const data = await getDepartments();
    setDepartments(data);
  };

  const loadFlows = async () => {
    const data = await getFlows();
    setFlows(data.filter(f => f.is_active));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const dataToSave = {
        ...formData,
        connection_id: formData.connection_id || null,
        ai_model: formData.ai_model || null,
        ai_api_key: formData.ai_api_key === '••••••••' ? undefined : formData.ai_api_key || null,
        ai_system_prompt: formData.ai_system_prompt || null,
        welcome_message: formData.welcome_message || null,
        description: formData.description || null,
        linked_flow_id: formData.linked_flow_id || null,
      };

      let result;
      if (chatbot) {
        result = await updateChatbot(chatbot.id, dataToSave);
      } else {
        result = await createChatbot(dataToSave);
      }

      if (result) {
        toast.success(chatbot ? 'Chatbot atualizado!' : 'Chatbot criado!');
        onClose(true);
      }
    } catch (error) {
      console.error('Erro ao salvar:', error);
      toast.error('Erro ao salvar chatbot');
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: number) => {
    setFormData(prev => ({
      ...prev,
      business_days: prev.business_days.includes(day)
        ? prev.business_days.filter(d => d !== day)
        : [...prev.business_days, day].sort()
    }));
  };

  const currentModels = formData.ai_provider === 'gemini' 
    ? aiModels.gemini 
    : formData.ai_provider === 'openai' 
      ? aiModels.openai 
      : [];

  return (
    <Dialog open={open} onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {chatbot ? 'Editar Chatbot' : 'Novo Chatbot'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configurações do chatbot
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general" className="flex items-center gap-1">
              <Settings className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="menu" className="flex items-center gap-1">
              <List className="h-4 w-4" />
              Menu
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Horário
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-1">
              <Sparkles className="h-4 w-4" />
              IA
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              Mensagens
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Chatbot *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Atendimento Inicial"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="connection">Conexão WhatsApp</Label>
                <Select
                  value={formData.connection_id || "all"}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, connection_id: value === "all" ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma conexão" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as conexões</SelectItem>
                    {connections.filter(conn => conn.id).map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        {conn.name} ({conn.phone})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descreva o propósito deste chatbot..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de Chatbot</Label>
              <Select
                value={formData.chatbot_type}
                onValueChange={(value: ChatbotType) => setFormData(prev => ({ ...prev, chatbot_type: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="traditional">
                    <div className="flex items-center gap-2">
                      <List className="h-4 w-4" />
                      Tradicional (Menu numérico)
                    </div>
                  </SelectItem>
                  <SelectItem value="flow">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Fluxo visual
                    </div>
                  </SelectItem>
                  <SelectItem value="ai">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      IA (respostas automáticas)
                    </div>
                  </SelectItem>
                  <SelectItem value="hybrid">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      Híbrido (Menu + IA)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.chatbot_type === 'traditional' && 'Menu com opções numeradas (1, 2, 3...)'}
                {formData.chatbot_type === 'flow' && 'Editor visual de fluxos de conversa'}
                {formData.chatbot_type === 'ai' && 'Respostas geradas por IA'}
                {formData.chatbot_type === 'hybrid' && 'Combina menu tradicional com respostas de IA'}
              </p>
            </div>

            {/* Seletor de Fluxo - aparece apenas quando tipo é 'flow' */}
            {formData.chatbot_type === 'flow' && (
              <div className="space-y-2">
                <Label>Fluxo Visual</Label>
                <Select
                  value={formData.linked_flow_id || "none"}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, linked_flow_id: value === "none" ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um fluxo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum fluxo selecionado</SelectItem>
                    {flows.map((flow) => (
                      <SelectItem key={flow.id} value={flow.id}>
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" />
                          {flow.name}
                          {flow.trigger_enabled && (
                            <Badge variant="outline" className="text-xs ml-1">
                              Gatilho ativo
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecione o fluxo visual que será executado por este chatbot.
                  {flows.length === 0 && " Você ainda não tem fluxos ativos. Crie um na página Fluxos."}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Modo de Operação</Label>
              <Select
                value={formData.mode}
                onValueChange={(value: ChatbotMode) => setFormData(prev => ({ ...prev, mode: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Sempre ativo</SelectItem>
                  <SelectItem value="business_hours">Apenas horário comercial</SelectItem>
                  <SelectItem value="outside_hours">Fora do horário comercial</SelectItem>
                  <SelectItem value="pre_service">Pré-atendimento (antes de humano)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-muted">
              <div>
                <Label>Ativar Chatbot</Label>
                <p className="text-sm text-muted-foreground">
                  O chatbot começará a responder quando ativado
                </p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
              />
            </div>
          </TabsContent>

          {/* Menu Tab - Traditional Chatbot */}
          <TabsContent value="menu" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <List className="h-5 w-5 text-primary" />
                  Menu Tradicional
                </CardTitle>
                <CardDescription>
                  Configure opções numeradas que o usuário pode digitar (1, 2, 3...)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {formData.chatbot_type !== 'traditional' && formData.chatbot_type !== 'hybrid' && (
                  <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg border border-amber-500/20">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">
                      Para usar o menu tradicional, selecione o tipo "Tradicional" ou "Híbrido" na aba Geral
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Mensagem do Menu</Label>
                  <Textarea
                    value={formData.menu_message}
                    onChange={(e) => setFormData(prev => ({ ...prev, menu_message: e.target.value }))}
                    placeholder="Olá! Escolha uma opção:&#10;&#10;1️⃣ Comercial&#10;2️⃣ Financeiro&#10;3️⃣ Suporte&#10;0️⃣ Falar com atendente"
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Esta mensagem será enviada quando o chatbot iniciar. Use emojis numéricos para melhor visualização.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Opções do Menu</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newOption: MenuOption = {
                          id: crypto.randomUUID(),
                          number: String(formData.menu_options.length + 1),
                          label: '',
                          action: 'message',
                          action_value: '',
                        };
                        setFormData(prev => ({
                          ...prev,
                          menu_options: [...prev.menu_options, newOption]
                        }));
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Opção
                    </Button>
                  </div>

                  {formData.menu_options.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                      <List className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Nenhuma opção configurada</p>
                      <p className="text-xs mt-1">
                        Clique em "Adicionar Opção" para criar opções de menu
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formData.menu_options.map((option, index) => (
                        <Card key={option.id} className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex items-center gap-2 pt-2">
                              <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                              <Badge variant="outline" className="font-mono">
                                {option.number}
                              </Badge>
                            </div>
                            <div className="flex-1 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Número</Label>
                                  <Input
                                    value={option.number}
                                    onChange={(e) => {
                                      const updated = [...formData.menu_options];
                                      updated[index] = { ...option, number: e.target.value };
                                      setFormData(prev => ({ ...prev, menu_options: updated }));
                                    }}
                                    placeholder="1"
                                    className="h-8"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Label</Label>
                                  <Input
                                    value={option.label}
                                    onChange={(e) => {
                                      const updated = [...formData.menu_options];
                                      updated[index] = { ...option, label: e.target.value };
                                      setFormData(prev => ({ ...prev, menu_options: updated }));
                                    }}
                                    placeholder="Comercial"
                                    className="h-8"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Ação</Label>
                                  <Select
                                    value={option.action}
                                    onValueChange={(value: MenuOption['action']) => {
                                      const updated = [...formData.menu_options];
                                      updated[index] = { ...option, action: value, action_value: '' };
                                      setFormData(prev => ({ ...prev, menu_options: updated }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="message">Enviar mensagem</SelectItem>
                                      <SelectItem value="transfer">Transferir para departamento</SelectItem>
                                      <SelectItem value="submenu">Submenu</SelectItem>
                                      <SelectItem value="tag">Adicionar tag</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">
                                    {option.action === 'message' && 'Mensagem'}
                                    {option.action === 'transfer' && 'Departamento'}
                                    {option.action === 'submenu' && 'ID do Submenu'}
                                    {option.action === 'tag' && 'Nome da Tag'}
                                  </Label>
                                  {option.action === 'transfer' ? (
                                    <Select
                                      value={option.action_value || "select"}
                                      onValueChange={(value) => {
                                        const updated = [...formData.menu_options];
                                        updated[index] = { ...option, action_value: value === "select" ? "" : value };
                                        setFormData(prev => ({ ...prev, menu_options: updated }));
                                      }}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Selecione..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="select">Selecione um departamento</SelectItem>
                                        {departments.filter(d => d.id && d.is_active).map(dept => (
                                          <SelectItem key={dept.id} value={dept.id}>
                                            <div className="flex items-center gap-2">
                                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color }} />
                                              {dept.name}
                                            </div>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      value={option.action_value}
                                      onChange={(e) => {
                                        const updated = [...formData.menu_options];
                                        updated[index] = { ...option, action_value: e.target.value };
                                        setFormData(prev => ({ ...prev, menu_options: updated }));
                                      }}
                                      placeholder={
                                        option.action === 'message' ? 'Aguarde, vou te ajudar...' :
                                        option.action === 'submenu' ? 'submenu_1' :
                                        'lead_quente'
                                      }
                                      className="h-8"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => {
                                setFormData(prev => ({
                                  ...prev,
                                  menu_options: prev.menu_options.filter((_, i) => i !== index)
                                }));
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Mensagem de Opção Inválida</Label>
                  <Input
                    value={formData.invalid_option_message}
                    onChange={(e) => setFormData(prev => ({ ...prev, invalid_option_message: e.target.value }))}
                    placeholder="Opção inválida. Por favor, digite um número válido."
                  />
                  <p className="text-xs text-muted-foreground">
                    Enviada quando o usuário digita uma opção que não existe
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Horário Comercial</CardTitle>
                <CardDescription>
                  Configure quando o chatbot deve operar baseado no modo selecionado
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Início</Label>
                    <Input
                      type="time"
                      value={formData.business_hours_start}
                      onChange={(e) => setFormData(prev => ({ ...prev, business_hours_start: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fim</Label>
                    <Input
                      type="time"
                      value={formData.business_hours_end}
                      onChange={(e) => setFormData(prev => ({ ...prev, business_hours_end: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Dias de Funcionamento</Label>
                  <div className="flex gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={formData.business_days.includes(day.value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleDay(day.value)}
                      >
                        {day.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Fuso Horário</Label>
                  <Select
                    value={formData.timezone}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, timezone: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Sao_Paulo">São Paulo (GMT-3)</SelectItem>
                      <SelectItem value="America/Manaus">Manaus (GMT-4)</SelectItem>
                      <SelectItem value="America/Fortaleza">Fortaleza (GMT-3)</SelectItem>
                      <SelectItem value="America/Cuiaba">Cuiabá (GMT-4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Tab */}
          <TabsContent value="ai" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Configuração de IA
                </CardTitle>
                <CardDescription>
                  Configure a inteligência artificial para respostas automáticas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Provedor de IA</Label>
                  <Select
                    value={formData.ai_provider}
                    onValueChange={(value: AIProvider) => {
                      setFormData(prev => ({ 
                        ...prev, 
                        ai_provider: value,
                        ai_model: '',
                        ai_api_key: ''
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4" />
                          Sem IA (apenas fluxos)
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-blue-500" />
                          Google Gemini
                        </div>
                      </SelectItem>
                      <SelectItem value="openai">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-green-500" />
                          OpenAI (GPT)
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.ai_provider !== 'none' && (
                  <>
                    <div className="space-y-2">
                      <Label>Modelo</Label>
                      <Select
                        value={formData.ai_model}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, ai_model: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um modelo" />
                        </SelectTrigger>
                        <SelectContent>
                          {currentModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              <div className="flex flex-col">
                                <span>{model.name}</span>
                                <span className="text-xs text-muted-foreground">{model.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>API Key</Label>
                      <div className="relative">
                        <Input
                          type={showApiKey ? "text" : "password"}
                          value={formData.ai_api_key}
                          onChange={(e) => setFormData(prev => ({ ...prev, ai_api_key: e.target.value }))}
                          placeholder={`Cole sua ${formData.ai_provider === 'gemini' ? 'Gemini' : 'OpenAI'} API Key`}
                          className="pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 top-1/2 -translate-y-1/2"
                          onClick={() => setShowApiKey(!showApiKey)}
                        >
                          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formData.ai_provider === 'gemini' 
                          ? 'Obtenha em: https://aistudio.google.com/apikey'
                          : 'Obtenha em: https://platform.openai.com/api-keys'
                        }
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Prompt do Sistema</Label>
                      <Textarea
                        value={formData.ai_system_prompt}
                        onChange={(e) => setFormData(prev => ({ ...prev, ai_system_prompt: e.target.value }))}
                        placeholder="Você é um assistente prestativo da empresa X. Responda de forma educada e objetiva..."
                        rows={4}
                      />
                      <p className="text-xs text-muted-foreground">
                        Instruções que definem como a IA deve se comportar
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Temperatura</Label>
                          <span className="text-sm text-muted-foreground">{formData.ai_temperature}</span>
                        </div>
                        <Slider
                          value={[formData.ai_temperature]}
                          onValueChange={([value]) => setFormData(prev => ({ ...prev, ai_temperature: value }))}
                          min={0}
                          max={1}
                          step={0.1}
                        />
                        <p className="text-xs text-muted-foreground">
                          Menor = mais preciso, Maior = mais criativo
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Max Tokens</Label>
                        <Input
                          type="number"
                          value={formData.ai_max_tokens}
                          onChange={(e) => setFormData(prev => ({ ...prev, ai_max_tokens: parseInt(e.target.value) || 500 }))}
                          min={100}
                          max={4000}
                        />
                        <p className="text-xs text-muted-foreground">
                          Limite de tokens por resposta
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Mensagens do Chatbot</CardTitle>
                <CardDescription>
                  Configure as mensagens automáticas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Mensagem de Boas-vindas</Label>
                  <Textarea
                    value={formData.welcome_message}
                    onChange={(e) => setFormData(prev => ({ ...prev, welcome_message: e.target.value }))}
                    placeholder="Olá! 👋 Sou o assistente virtual da empresa. Como posso ajudar?"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Mensagem de Fallback</Label>
                  <Textarea
                    value={formData.fallback_message}
                    onChange={(e) => setFormData(prev => ({ ...prev, fallback_message: e.target.value }))}
                    placeholder="Desculpe, não entendi. Vou transferir você para um atendente."
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enviada quando o bot não entende a mensagem
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Transferir após X falhas</Label>
                    <Input
                      type="number"
                      value={formData.transfer_after_failures}
                      onChange={(e) => setFormData(prev => ({ ...prev, transfer_after_failures: parseInt(e.target.value) || 3 }))}
                      min={1}
                      max={10}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Delay de digitação (ms)</Label>
                    <Input
                      type="number"
                      value={formData.typing_delay_ms}
                      onChange={(e) => setFormData(prev => ({ ...prev, typing_delay_ms: parseInt(e.target.value) || 1500 }))}
                      min={500}
                      max={5000}
                      step={500}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} variant="gradient">
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
