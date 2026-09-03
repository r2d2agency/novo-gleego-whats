import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Loader2, 
  RefreshCw,
  Phone,
  Calendar,
  Timer,
  Users,
  MessageSquare,
  AlertCircle,
  Volume2,
  VolumeX,
  Pause as PauseIcon,
  Search,
  Download
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface CampaignMessage {
  id: string;
  phone: string;
  contact_name?: string;
  message_template_name?: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  sent_at?: string;
  scheduled_at?: string;
  error_message?: string;
  created_at: string;
}

interface CampaignDetails {
  campaign: {
    id: string;
    name: string;
    status: string;
    list_name: string;
    message_name: string;
    connection_name: string;
    min_delay: number;
    max_delay: number;
    pause_after_messages: number;
    pause_duration: number;
    sent_count: number;
    failed_count: number;
    total_contacts: number;
  };
  messages: CampaignMessage[];
  stats: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
  };
  estimatedCompletion: string | null;
}

interface CampaignDetailModalProps {
  campaignId: string | null;
  open: boolean;
  onClose: () => void;
}

const statusConfig = {
  sent: { icon: CheckCircle2, label: "Enviado", color: "text-green-500", bgColor: "bg-green-500/10" },
  failed: { icon: XCircle, label: "Falhou", color: "text-red-500", bgColor: "bg-red-500/10" },
  pending: { icon: Clock, label: "Aguardando", color: "text-yellow-500", bgColor: "bg-yellow-500/10" },
  processing: { icon: Loader2, label: "Enviando", color: "text-blue-500", bgColor: "bg-blue-500/10" },
  cancelled: { icon: AlertCircle, label: "Cancelado", color: "text-muted-foreground", bgColor: "bg-muted" },
};

// Translate common error messages to Portuguese
const translateError = (error?: string): string => {
  if (!error) return "Erro desconhecido";
  
  const errorTranslations: Record<string, string> = {
    "not a whatsapp number": "Número não é WhatsApp",
    "number not on whatsapp": "Número não está no WhatsApp",
    "invalid number": "Número inválido",
    "connection closed": "Conexão fechada",
    "timeout": "Tempo esgotado (15s)",
    "rate limit": "Limite de envio atingido (Spam)",
    "blocked": "Número bloqueado",
    "not found": "Número não encontrado",
    "unauthorized": "Token de autenticação inválido",
    "instance not connected": "Conexão não ativa no backend",
    "failed to send": "Falha genérica no envio",
    "media not found": "Mídia não encontrada",
    "invalid media": "Mídia inválida",
    "file too large": "Arquivo muito grande",
    "unsupported media type": "Tipo de mídia não suportado",
    "network error": "Erro de rede / DNS",
    "server error": "Erro interno da Meta/Servidor",
    "190": "Token expirado ou revogado (Reconecte)",
    "401": "Erro de autenticação na Meta",
  };

  const lowerError = String(error || "").toLowerCase();
  
  for (const [key, translation] of Object.entries(errorTranslations)) {
    if (lowerError.includes(key)) {
      return translation;
    }
  }

  // Handle Meta specific error codes if present in the string
  const metaErrorCodeMatch = lowerError.match(/#(\d+):/);
  if (metaErrorCodeMatch && errorTranslations[metaErrorCodeMatch[1]]) {
    return errorTranslations[metaErrorCodeMatch[1]];
  }

  if (error.length > 500) {
    return error.substring(0, 497) + "...";
  }
  
  return error;
};

export function CampaignDetailModal({ campaignId, open, onClose }: CampaignDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CampaignDetails | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed' | 'pending'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevStatusRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create audio element for notification sound
  useEffect(() => {
    // Use a simple beep sound using Web Audio API
    const createNotificationSound = () => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    };

    // Store the function in ref for later use
    (audioRef as any).playSound = createNotificationSound;
  }, []);

  const playCompletionSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      (audioRef as any).playSound?.();
    } catch (e) {
      console.log('Could not play sound:', e);
    }
  }, [soundEnabled]);

  const loadDetails = useCallback(async () => {
    if (!campaignId) return;
    
    setLoading(true);
    try {
      const data = await api<CampaignDetails>(`/api/campaigns/${campaignId}/details`);
      
      // Check if campaign just completed
      if (prevStatusRef.current && 
          prevStatusRef.current !== 'completed' && 
          data.campaign.status === 'completed') {
        playCompletionSound();
        toast.success('🎉 Campanha concluída!', {
          description: `${data.stats.sent} mensagens enviadas com sucesso`,
        });
      }
      
      prevStatusRef.current = data.campaign.status;
      setDetails(data);
    } catch (error) {
      console.error('Error loading campaign details:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId, playCompletionSound]);

  useEffect(() => {
    if (open && campaignId) {
      prevStatusRef.current = null;
      loadDetails();
      setCountdown(10);
      setSearchTerm('');
      setStatusFilter('all');
    }
  }, [open, campaignId, loadDetails]);

  const exportFilteredMessages = () => {
    if (!details?.messages) return;

    const filtered = details.messages.filter(msg => {
      const matchesStatus = statusFilter === 'all' || msg.status === statusFilter;
      const search = searchTerm.toLowerCase().trim();
      
      // Clean search term and phone for better matching
      const cleanSearch = search.replace(/\D/g, '');
      const cleanPhone = msg.phone.replace(/\D/g, '');

      const matchesSearch = !search || 
        (msg.contact_name?.toLowerCase().includes(search)) || 
        (msg.phone.includes(search)) ||
        (cleanSearch !== '' && cleanPhone.includes(cleanSearch));
      return matchesStatus && matchesSearch;
    });

    if (filtered.length === 0) {
      toast.error("Nenhum dado para exportar com os filtros atuais");
      return;
    }

    const headers = ["Nome", "Telefone", "Status", "Data de Envio", "Erro"];
    const rows = filtered.map(msg => [
      msg.contact_name || "",
      msg.phone,
      msg.status === 'sent' ? 'Enviado' : msg.status === 'failed' ? 'Falha' : 'Pendente',
      msg.sent_at ? format(new Date(msg.sent_at), "dd/MM/yyyy HH:mm:ss") : "",
      msg.error_message || ""
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `campanha_${details.campaign.name.replace(/\s+/g, '_')}_detalhes.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Exportação concluída com sucesso!");
  };

  // Auto-refresh for running and pending campaigns
  useEffect(() => {
    if (!open || !autoRefresh || !details?.campaign) return;
    
    // Only auto-refresh for active campaigns
    const isActive = ['running', 'pending', 'paused'].includes(details.campaign.status);
    if (!isActive) return;

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          loadDetails();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [open, autoRefresh, details?.campaign?.status, loadDetails]);

  if (!open) return null;

  const progress = details?.stats 
    ? ((details.stats.sent + details.stats.failed) / details.stats.total) * 100 
    : 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2 truncate">
              <MessageSquare className="h-5 w-5 text-primary" />
              {details?.campaign?.name || 'Carregando...'}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {/* Sound toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSoundEnabled(!soundEnabled)}
                title={soundEnabled ? "Som ativado" : "Som desativado"}
              >
                {soundEnabled ? (
                  <Volume2 className="h-4 w-4 text-primary" />
                ) : (
                  <VolumeX className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              
              {/* Auto-refresh toggle */}
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", !autoRefresh && "text-muted-foreground")}
                onClick={() => setAutoRefresh(!autoRefresh)}
                title={autoRefresh ? "Atualização automática ativada" : "Atualização automática desativada"}
              >
                {autoRefresh ? (
                  <RefreshCw className="h-4 w-4 text-primary" />
                ) : (
                  <PauseIcon className="h-4 w-4" />
                )}
              </Button>
              
              {/* Countdown indicator */}
              {autoRefresh && details?.campaign && ['running', 'pending', 'paused'].includes(details.campaign.status) && (
                <span className="text-xs text-muted-foreground tabular-nums min-w-[24px]">
                  {countdown}s
                </span>
              )}
              
              {/* Manual refresh */}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  loadDetails();
                  setCountdown(10);
                }}
                disabled={loading}
                title="Atualizar agora"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <DialogDescription>
            Acompanhe o progresso e status das mensagens da campanha. Você pode ver os erros detalhados na lista abaixo.
          </DialogDescription>
        </DialogHeader>

        {loading && !details ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : details ? (
          <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-accent/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{details.stats.total}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Users className="h-3 w-3" /> Total
                </div>
              </div>
              <div className="bg-green-500/10 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-500">{details.stats.sent}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Enviados
                </div>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-500">{details.stats.failed}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <XCircle className="h-3 w-3" /> Falhas
                </div>
              </div>
              <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-500">{details.stats.pending}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Clock className="h-3 w-3" /> Pendentes
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progresso</span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Estimated Completion */}
            {details.estimatedCompletion && details.campaign.status === 'running' && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Timer className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  <span className="text-muted-foreground">Previsão de término:</span>{' '}
                  <span className="font-medium">
                    {format(new Date(details.estimatedCompletion), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    ({formatDistanceToNow(new Date(details.estimatedCompletion), { locale: ptBR, addSuffix: true })})
                  </span>
                </span>
              </div>
            )}

            {/* Campaign Info */}
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="outline" className="gap-1">
                <Phone className="h-3 w-3" />
                {details.campaign.connection_name}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Users className="h-3 w-3" />
                {details.campaign.list_name}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                {details.campaign.message_name}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Timer className="h-3 w-3" />
                {details.campaign.min_delay}-{details.campaign.max_delay}s
              </Badge>
            </div>

            {/* Messages List */}
            <div className="flex-1 min-h-0">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-4">
                  <h3 className="text-sm font-medium flex items-center gap-2 whitespace-nowrap">
                    <Users className="h-4 w-4" />
                    Contatos ({details.messages.length})
                  </h3>
                  
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar nome ou telefone..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-accent/30 p-1 rounded-md">
                    <Badge 
                      variant={statusFilter === 'all' ? "default" : "outline"}
                      className="cursor-pointer text-[10px] px-2 py-0 h-6"
                      onClick={() => setStatusFilter('all')}
                    >
                      Todos
                    </Badge>
                    <Badge 
                      variant={statusFilter === 'sent' ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer text-[10px] px-2 py-0 h-6", 
                        statusFilter !== 'sent' && "text-green-500 hover:bg-green-500/10 border-green-500/30"
                      )}
                      onClick={() => setStatusFilter('sent')}
                    >
                      Enviados
                    </Badge>
                    <Badge 
                      variant={statusFilter === 'failed' ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer text-[10px] px-2 py-0 h-6", 
                        statusFilter !== 'failed' && "text-red-500 hover:bg-red-500/10 border-red-500/30"
                      )}
                      onClick={() => setStatusFilter('failed')}
                    >
                      Erros
                    </Badge>
                    <Badge 
                      variant={statusFilter === 'pending' ? "default" : "outline"}
                      className={cn(
                        "cursor-pointer text-[10px] px-2 py-0 h-6", 
                        statusFilter !== 'pending' && "text-yellow-500 hover:bg-yellow-500/10 border-yellow-500/30"
                      )}
                      onClick={() => setStatusFilter('pending')}
                    >
                      Pendentes
                    </Badge>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 text-xs"
                    onClick={exportFilteredMessages}
                    title="Exportar filtros atuais para CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-[40vh] rounded-lg border">
                <div className="divide-y divide-border">
                  {details.messages
                    .filter(msg => {
                      const matchesStatus = statusFilter === 'all' || msg.status === statusFilter;
                      const search = searchTerm.toLowerCase().trim();
                      
                      // Clean search term and phone for better matching
                      const cleanSearch = search.replace(/\D/g, '');
                      const cleanPhone = msg.phone.replace(/\D/g, '');

                      const matchesSearch = !search || 
                        (msg.contact_name?.toLowerCase().includes(search)) || 
                        (msg.phone.includes(search)) ||
                        (cleanSearch !== '' && cleanPhone.includes(cleanSearch));
                      return matchesStatus && matchesSearch;
                    })
                    .map((msg) => {
                    const config = statusConfig[msg.status] || statusConfig.pending;
                    const StatusIcon = config.icon;
                    
                    return (
                      <div 
                        key={msg.id} 
                        className={cn(
                          "flex items-center justify-between p-3 hover:bg-accent/30 transition-colors",
                          config.bgColor
                        )}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <StatusIcon className={cn("h-4 w-4 flex-shrink-0", config.color)} />
                          <div className="min-w-0">
                            <div className="font-medium text-sm">
                              {msg.contact_name || 'Contato'}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {msg.phone}
                            </div>
                            {msg.message_template_name && (
                              <div className="text-xs text-primary/80 truncate mt-0.5" title={msg.message_template_name}>
                                <MessageSquare className="h-3 w-3 inline mr-1" />
                                {msg.message_template_name}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="text-right">
                          {msg.status === 'sent' && msg.sent_at && (
                            <div className="text-xs text-muted-foreground">
                              <span className="text-green-500 font-medium">Enviado</span>
                              <br />
                              {format(new Date(msg.sent_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                            </div>
                          )}
                          {msg.status === 'failed' && (
                            <div className="text-xs text-right">
                              <span className="text-red-500 font-medium">Falhou</span>
                              <div className="text-red-400 max-w-[500px] break-words text-xs leading-tight" title={msg.error_message}>
                                {translateError(msg.error_message)}
                              </div>
                            </div>
                          )}
                          {msg.status === 'pending' && msg.scheduled_at && (
                            <div className="text-xs text-right">
                              <span className="text-yellow-500 font-medium">Agendado para</span>
                              <div className="text-muted-foreground font-medium">
                                {format(new Date(msg.scheduled_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                              </div>
                            </div>
                          )}
                          {msg.status === 'pending' && !msg.scheduled_at && (
                            <div className="text-xs text-muted-foreground">
                              <span className="text-yellow-500 font-medium">Pendente</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {details.messages.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Nenhuma mensagem processada ainda</p>
                      <p className="text-xs mt-1">
                        As mensagens aparecerão aqui quando a campanha iniciar
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Erro ao carregar detalhes
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
