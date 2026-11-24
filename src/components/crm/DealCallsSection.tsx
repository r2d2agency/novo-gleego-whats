import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, PhoneCall, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface DealCall {
  id: string;
  created_at: string;
  call_type: string;
  outcome: string;
  duration_seconds: number;
  notes?: string;
  contact_name?: string;
  contact_phone?: string;
  user_name?: string;
}

const outcomeLabels: Record<string, string> = {
  answered: 'Atendeu',
  voicemail: 'Caixa postal',
  no_answer: 'Não atendeu',
  busy: 'Ocupado',
  scheduled_callback: 'Retorno agendado',
  deal_closed: 'Negócio fechado',
  not_interested: 'Sem interesse',
  follow_up: 'Necessita follow-up',
};
const typeLabels: Record<string, string> = {
  outgoing: 'Realizada',
  incoming: 'Recebida',
  missed: 'Perdida',
};
const durationLabel = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

interface DealCallsSectionProps {
  dealId: string;
  contactName?: string;
  contactPhone?: string;
}

export function DealCallsSection({ dealId, contactName, contactPhone }: DealCallsSectionProps) {
  const [calls, setCalls] = useState<DealCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [callType, setCallType] = useState('outgoing');
  const [outcome, setOutcome] = useState('answered');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<DealCall[]>(`/api/chat/deals/${dealId}/call-logs`);
      setCalls(result);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dealId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/api/chat/deals/${dealId}/call-log`, {
        method: 'POST',
        body: {
          call_type: callType,
          outcome,
          duration_seconds: (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
          notes,
        },
      });
      toast.success('Ligação registrada no card');
      setMinutes(''); setSeconds(''); setNotes('');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao registrar ligação');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium flex items-center gap-2"><PhoneCall className="h-4 w-4 text-primary" /> Registrar ligação</h4>
          <Button variant="ghost" size="icon" onClick={load} aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
        </div>
        <p className="text-sm text-muted-foreground">Contato: {contactName || contactPhone || 'Não informado'}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={callType} onValueChange={setCallType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">Ligação realizada</SelectItem>
                <SelectItem value="incoming">Ligação recebida</SelectItem>
                <SelectItem value="missed">Ligação perdida</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Resultado</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(outcomeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Minutos</Label>
            <Input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Segundos</Label>
            <Input type="number" min="0" max="59" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações da ligação" />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
          Salvar ligação
        </Button>
      </Card>

      <Card className="p-4">
        <h4 className="font-medium mb-3">Ligações vinculadas ({calls.length})</h4>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ligação registrada nesta negociação.</p>
        ) : (
          <div className="space-y-2">
            {calls.map((call) => (
              <div key={call.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{typeLabels[call.call_type] || call.call_type}</Badge>
                    <Badge variant={call.outcome === 'answered' ? 'default' : 'secondary'}>
                      {outcomeLabels[call.outcome] || call.outcome}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{durationLabel(Number(call.duration_seconds || 0))}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(call.created_at).toLocaleString('pt-BR')}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium">{call.contact_name || call.contact_phone || 'Contato não informado'}</p>
                <p className="text-xs text-muted-foreground">{call.user_name || 'Sem responsável'}</p>
                {call.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{call.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
