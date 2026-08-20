import { useState, useEffect } from "react";
import { FileUploadInput } from "@/components/ui/file-upload-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
  Palette,
  FileText,
  Settings,
  MessageSquare,
} from "lucide-react";
import { useExternalForms, ExternalForm, FormField } from "@/hooks/use-external-forms";
import { useFlows } from "@/hooks/use-flows";
import { useConnectionStatus } from "@/hooks/use-connection-status";

interface ExternalFormEditorDialogProps {
  open: boolean;
  onClose: () => void;
  form?: ExternalForm | null;
}

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "textarea", label: "Texto longo" },
  { value: "select", label: "Seleção" },
];

const DEFAULT_FIELDS: FormField[] = [
  { field_key: "name", field_label: "Qual é o seu nome?", field_type: "text", is_required: true },
  { field_key: "phone", field_label: "Seu WhatsApp com DDD", field_type: "phone", is_required: true, placeholder: "(11) 99999-9999" },
  { field_key: "city", field_label: "Em qual cidade você está?", field_type: "text", is_required: false },
  { field_key: "state", field_label: "E o estado?", field_type: "text", is_required: false },
];

export function ExternalFormEditorDialog({
  open,
  onClose,
  form,
}: ExternalFormEditorDialogProps) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("fields");
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    logo_url: "",
    logo_size: 48,
    primary_color: "#6366f1",
    background_color: "#ffffff",
    text_color: "#1f2937",
    button_text: "Enviar",
    welcome_message: "Olá! Vamos começar?",
    thank_you_message: "Obrigado pelo contato! Em breve entraremos em contato.",
    redirect_url: "",
    trigger_flow_id: "",
    connection_id: "",
    display_mode: ("chat" as "chat" | "typeform" | "standard"),
  });
  
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);

  const { createForm, updateForm, getForm } = useExternalForms();
  const { getFlows } = useFlows();
  const { connections } = useConnectionStatus({ autoStart: true });
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (open) {
      loadFlows();
      if (form) {
        loadFormDetails();
      } else {
        resetForm();
      }
    }
  }, [open, form?.id]);

  const loadFlows = async () => {
    const result = await getFlows();
    setFlows(result.filter((f) => f.is_active));
  };

  const loadFormDetails = async () => {
    if (!form?.id) return;
    
    const fullForm = await getForm(form.id);
    if (fullForm) {
      setFormData({
        name: fullForm.name || "",
        description: fullForm.description || "",
        logo_url: fullForm.logo_url || "",
        logo_size: fullForm.logo_size || 48,
        primary_color: fullForm.primary_color || "#6366f1",
        background_color: fullForm.background_color || "#ffffff",
        text_color: fullForm.text_color || "#1f2937",
        button_text: fullForm.button_text || "Enviar",
        welcome_message: fullForm.welcome_message || "Olá! Vamos começar?",
        thank_you_message: fullForm.thank_you_message || "Obrigado pelo contato!",
        redirect_url: fullForm.redirect_url || "",
        trigger_flow_id: fullForm.trigger_flow_id || "",
        connection_id: fullForm.connection_id || "",
        display_mode: (fullForm.display_mode as "chat" | "typeform" | "standard") || "chat",
      });
      setFields(fullForm.fields || DEFAULT_FIELDS);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      logo_url: "",
      logo_size: 48,
      primary_color: "#6366f1",
      background_color: "#ffffff",
      text_color: "#1f2937",
      button_text: "Enviar",
      welcome_message: "Olá! Vamos começar?",
      thank_you_message: "Obrigado pelo contato! Em breve entraremos em contato.",
      redirect_url: "",
      trigger_flow_id: "",
      connection_id: "",
      display_mode: "chat",
    });
    setFields(DEFAULT_FIELDS);
    setActiveTab("fields");
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    if (fields.length === 0) {
      toast.error("Adicione pelo menos um campo");
      return;
    }

    setLoading(true);
    
    try {
      const payload = {
        ...formData,
        trigger_flow_id: formData.trigger_flow_id || undefined,
        connection_id: formData.connection_id || undefined,
        fields: fields.map((f, idx) => ({ ...f, position: idx })),
      };

      if (form?.id) {
        await updateForm.mutateAsync({ id: form.id, ...payload });
      } else {
        await createForm.mutateAsync(payload);
      }
      
      onClose();
    } catch (err) {
      // Error toast handled by hook
    }
    
    setLoading(false);
  };

  const addField = () => {
    const key = `field_${Date.now()}`;
    setFields([
      ...fields,
      {
        field_key: key,
        field_label: "Nova pergunta",
        field_type: "text",
        is_required: false,
      },
    ]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const moveField = (from: number, to: number) => {
    const newFields = [...fields];
    const [removed] = newFields.splice(from, 1);
    newFields.splice(to, 0, removed);
    setFields(newFields);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {form ? "Editar Formulário" : "Novo Formulário"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
            <TabsTrigger value="fields" className="gap-1 text-xs sm:text-sm px-2">
              <MessageSquare className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Campos</span>
            </TabsTrigger>
            <TabsTrigger value="style" className="gap-1 text-xs sm:text-sm px-2">
              <Palette className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Estilo</span>
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1 text-xs sm:text-sm px-2">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Mensagens</span>
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1 text-xs sm:text-sm px-2">
              <Settings className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Ações</span>
            </TabsTrigger>
          </TabsList>

          {/* FIELDS TAB */}
          <TabsContent value="fields" className="mt-4 flex-1 min-h-0">
            <ScrollArea className="h-[calc(90vh-280px)] min-h-[250px]">
              <div className="pr-4 space-y-4">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Nome do Formulário *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ex: Captura de Leads - Black Friday"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Descrição (opcional)</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Descrição interna do formulário"
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-base">Perguntas do Formulário</Label>
                    <Button variant="outline" size="sm" onClick={addField}>
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Campo
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <Card key={field.id || index} className="relative">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-1 mt-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={index === 0}
                                onClick={() => moveField(index, index - 1)}
                              >
                                <span className="text-xs">↑</span>
                              </Button>
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={index === fields.length - 1}
                                onClick={() => moveField(index, index + 1)}
                              >
                                <span className="text-xs">↓</span>
                              </Button>
                            </div>

                            <div className="flex-1 grid gap-3">
                              <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Pergunta</Label>
                                  <Input
                                    value={field.field_label}
                                    onChange={(e) => updateField(index, { field_label: e.target.value })}
                                    placeholder="Digite a pergunta..."
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Tipo</Label>
                                  <Select
                                    value={field.field_type}
                                    onValueChange={(value) => updateField(index, { field_type: value as FormField["field_type"] })}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {FIELD_TYPES.map((type) => (
                                        <SelectItem key={type.value} value={type.value}>
                                          {type.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Placeholder (opcional)</Label>
                                  <Input
                                    value={field.placeholder || ""}
                                    onChange={(e) => updateField(index, { placeholder: e.target.value })}
                                    placeholder="Ex: Digite aqui..."
                                  />
                                </div>
                                <div className="flex items-center gap-4 pt-5">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={field.is_required}
                                      onCheckedChange={(checked) => updateField(index, { is_required: checked })}
                                    />
                                    <Label className="text-xs">Obrigatório</Label>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    {field.field_key}
                                  </Badge>
                                </div>
                              </div>

                              {field.field_type === "select" && (
                                <div className="space-y-1">
                                  <Label className="text-xs">Opções (uma por linha)</Label>
                                  <Textarea
                                    value={(field.options || []).join("\n")}
                                    onChange={(e) =>
                                      updateField(index, {
                                        options: e.target.value.split("\n"),
                                      })
                                    }
                                    onBlur={(e) =>
                                      updateField(index, {
                                        options: e.target.value
                                          .split("\n")
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                    placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
                                    className="min-h-[80px]"
                                  />
                                </div>
                              )}
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeField(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* STYLE TAB */}
          <TabsContent value="style" className="mt-4 flex-1 min-h-0">
            <ScrollArea className="h-[calc(90vh-280px)] min-h-[250px]">
              <div className="pr-4 space-y-4">
                <div className="grid gap-2">
                  <Label>Layout do Formulário</Label>
                  <div className="grid sm:grid-cols-3 gap-2">
                    {[
                      { value: "chat", label: "Chat", desc: "Conversa em bolhas (atual)" },
                      { value: "typeform", label: "Typeform", desc: "1 pergunta por vez com animação" },
                      { value: "standard", label: "Padrão", desc: "Formulário clássico (embed)" },
                    ].map((opt) => {
                      const active = formData.display_mode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormData({ ...formData, display_mode: opt.value as "chat" | "typeform" | "standard" })}
                          className={`text-left border rounded-lg p-3 transition-all ${
                            active
                              ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="font-medium text-sm">{opt.label}</div>
                          <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                  {formData.display_mode === "standard" && (
                    <p className="text-xs text-muted-foreground">
                      No modo padrão o formulário pode ser inserido em qualquer site via iframe:
                      <code className="ml-1 px-1 py-0.5 rounded bg-muted">
                        {`<iframe src="${window.location.origin}/f/SEU-SLUG" width="100%" height="600" frameborder="0"></iframe>`}
                      </code>
                    </p>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Logo (opcional)</Label>
                    <FileUploadInput
                      value={formData.logo_url}
                      onChange={(url) => setFormData({ ...formData, logo_url: url })}
                      accept="image/*"
                      placeholder="https://exemplo.com/logo.png"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Tamanho da Logo (px)</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="number"
                        value={formData.logo_size}
                        onChange={(e) => setFormData({ ...formData, logo_size: parseInt(e.target.value) || 48 })}
                        className="flex-1"
                        min={20}
                        max={300}
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formData.logo_size}px</span>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="grid gap-2">
                    <Label>Cor Principal</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={formData.primary_color}
                        onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                        className="w-12 h-10 p-1"
                      />
                      <Input
                        value={formData.primary_color}
                        onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Cor de Fundo</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={formData.background_color}
                        onChange={(e) => setFormData({ ...formData, background_color: e.target.value })}
                        className="w-12 h-10 p-1"
                      />
                      <Input
                        value={formData.background_color}
                        onChange={(e) => setFormData({ ...formData, background_color: e.target.value })}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Cor do Texto</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={formData.text_color}
                        onChange={(e) => setFormData({ ...formData, text_color: e.target.value })}
                        className="w-12 h-10 p-1"
                      />
                      <Input
                        value={formData.text_color}
                        onChange={(e) => setFormData({ ...formData, text_color: e.target.value })}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Texto do Botão</Label>
                  <Input
                    value={formData.button_text}
                    onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
                    placeholder="Enviar"
                  />
                </div>

                {/* Preview */}
                <div className="border rounded-lg p-4 mt-4">
                  <Label className="text-xs text-muted-foreground mb-2 block">Preview</Label>
                  <div
                    className="rounded-lg p-6 min-h-[200px] flex flex-col items-center justify-center gap-4"
                    style={{ backgroundColor: formData.background_color }}
                  >
                    {formData.logo_url && (
                      <img
                        src={formData.logo_url}
                        alt="Logo"
                        style={{ height: `${formData.logo_size}px` }}
                        className="object-contain"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    )}
                    <p style={{ color: formData.text_color }} className="text-center">
                      {formData.welcome_message || "Olá! Vamos começar?"}
                    </p>
                    <button
                      className="px-6 py-2 rounded-full text-white font-medium"
                      style={{ backgroundColor: formData.primary_color }}
                    >
                      {formData.button_text || "Enviar"}
                    </button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* MESSAGES TAB */}
          <TabsContent value="messages" className="mt-4 flex-1 min-h-0">
            <ScrollArea className="h-[calc(90vh-280px)] min-h-[250px]">
              <div className="pr-4 space-y-4">
                <div className="grid gap-2">
                  <Label>Mensagem de Boas-vindas</Label>
                  <Textarea
                    value={formData.welcome_message}
                    onChange={(e) => setFormData({ ...formData, welcome_message: e.target.value })}
                    placeholder="Olá! Vamos começar?"
                    className="min-h-[80px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Primeira mensagem exibida ao visitante no chat
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Mensagem de Agradecimento</Label>
                  <Textarea
                    value={formData.thank_you_message}
                    onChange={(e) => setFormData({ ...formData, thank_you_message: e.target.value })}
                    placeholder="Obrigado pelo contato! Em breve entraremos em contato."
                    className="min-h-[80px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Exibida após o envio do formulário
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>URL de Redirecionamento (opcional)</Label>
                  <Input
                    value={formData.redirect_url}
                    onChange={(e) => setFormData({ ...formData, redirect_url: e.target.value })}
                    placeholder="https://exemplo.com/obrigado"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se preenchido, redireciona o visitante após a mensagem de agradecimento
                  </p>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ACTIONS TAB */}
          <TabsContent value="actions" className="mt-4 flex-1 min-h-0">
            <ScrollArea className="h-[calc(90vh-280px)] min-h-[250px]">
              <div className="pr-4 space-y-4">
                <div className="grid gap-2">
                  <Label>Disparar Fluxo Automático (opcional)</Label>
                  <Select
                    value={formData.trigger_flow_id || "__none__"}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        trigger_flow_id: value === "__none__" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um fluxo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {flows
                        .filter((flow) => flow.id && String(flow.id).trim() !== "")
                        .map((flow) => (
                        <SelectItem key={flow.id} value={flow.id}>
                          {flow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Inicia automaticamente um fluxo de automação após o envio
                  </p>
                </div>

                {formData.trigger_flow_id && (
                  <div className="grid gap-2">
                    <Label>Conexão para Disparo</Label>
                    <Select
                      value={formData.connection_id || "__none__"}
                      onValueChange={(value) => setFormData({ ...formData, connection_id: value === "__none__" ? "" : value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma conexão..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhuma</SelectItem>
                        {connections
                          .filter((conn) => conn.id && String(conn.id).trim() !== "")
                          .map((conn) => (
                          <SelectItem key={conn.id} value={conn.id}>
                            {conn.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Conexão WhatsApp usada para enviar mensagens do fluxo
                    </p>
                  </div>
                )}

                <div className="border rounded-lg p-4 bg-muted/50">
                  <h4 className="font-medium mb-2">Variáveis Disponíveis</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Os dados capturados ficam disponíveis como variáveis no fluxo:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {fields.map((field) => (
                      <Badge key={field.field_key} variant="secondary">
                        {`{${field.field_key}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {form ? "Salvar" : "Criar Formulário"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
