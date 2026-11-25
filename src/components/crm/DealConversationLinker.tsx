import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface DealConversation {
  id: string;
  contact_name?: string;
  contact_phone?: string;
  connection_name?: string;
  last_message_at?: string;
  created_at?: string;
  attendance_status?: string;
  assigned_name?: string;
}

interface ConversationSummary {
  summary?: string;
  key_points?: string[];
  action_items?: string[];
}

interface DealConversationLinkerProps {
  dealId: string;
  contactPhone?: string;
  onLinked?: () => void;
}

export function DealConversationLinker({ dealId, contactPhone, onLinked }: DealConversationLinkerProps) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<DealConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    if (!contactPhone) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await api<DealConversation[]>(`/api/chat/conversations/list-by-phone/${encodeURIComponent(contactPhone)}`);
      setConversations(rows || []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [contactPhone]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((candidate) => candidate !== id) : [...prev, id]));
  };

  const handleLink = async () => {
    if (selected.length === 0) {
      toast.error('Selecione ao menos uma conversa');
      return;
    }
    setLinking(true);
    let linked = 0;
    try {
      for (const conversationId of selected) {
        const conversation = conversations.find((candidate) => candidate.id === conversationId);
        try {
          const summary = await api<ConversationSummary>(`/api/conversation-summary/${conversationId}`);
          const lines = [
            'Resumo do chat vinculado pelo card da negociação',
            conversation?.contact_name ? `Contato: ${conversation.contact_name}` : null,
            conversation?.contact_phone ? `Telefone: ${conversation.contact_phone}` : null,
            conversation?.connection_name ? `Conexão: ${conversation.connection_name}` : null,
            conversation?.last_message_at ? `Última mensagem: ${new Date(conversation.last_message_at).toLocaleString('pt-BR')}` : null,
            summary?.summary ? '' : null,
            summary?.summary ? `Resumo: ${summary.summary}` : null,
            summary?.key_points?.length
              ? `Pontos principais:\n${summary.key_points.map((point) => `• ${point}`).join('\n')}`
              : null,
            summary?.action_items?.length
              ? `Ações pendentes:\n${summary.action_items.map((action) => `• ${action}`).join('\n')}`
              : null,
          ].filter(Boolean).join('\n');
          await api(`/api/crm/deals/${dealId}/history`, {
            method: 'POST',
            body: { action: 'note', notes: lines },
          });
          linked += 1;
        } catch {
          // ignore and continue
        }
      }
      toast.success(`${linked} conversa(s) vinculada(s) ao histórico`);
      setSelected([]);
      onLinked?.();
    } finally {
      setLinking(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Conversas deste contato
        </h4>
        <Button variant="ghost" size="icon" onClick={load} aria-label="Atualizar conversas">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada para este contato.</p>
      ) : (
        <>
          <div className="space-y-2">
            {conversations.map((conversation) => (
              <label key={conversation.id} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                <Checkbox checked={selected.includes(conversation.id)} onCheckedChange={() => toggle(conversation.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium truncate">{conversation.contact_name || conversation.contact_phone || 'Conversa'}</span>
                    {conversation.attendance_status && <Badge variant="outline">{conversation.attendance_status}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {conversation.connection_name || ''}{conversation.assigned_name ? ` • ${conversation.assigned_name}` : ''}
                    {conversation.last_message_at ? ` • ${new Date(conversation.last_message_at).toLocaleString('pt-BR')}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => { event.preventDefault(); navigate(`/chat?conversation=${conversation.id}`); }}
                  aria-label="Abrir no chat"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </label>
            ))}
          </div>
          <Button onClick={handleLink} disabled={linking || selected.length === 0}>
            {linking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Anexar {selected.length > 0 ? `${selected.length} ` : ''}resumo(s) ao histórico
          </Button>
        </>
      )}
    </Card>
  );
}
