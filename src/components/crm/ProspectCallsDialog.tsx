import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface ProspectCallsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospectId: string;
  prospectName: string;
  prospectPhone?: string;
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
const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function ProspectCallsDialog({ open, onOpenChange, prospectId, prospectName, prospectPhone }: ProspectCallsDialogProps) {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [callType, setCallType] = useState('outgoing');
  const [outcome, setOutcome] = useState('answered');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api<any[]>(`/api/chat/prospects/${prospectId}/call-logs`);
      setCalls(rows || []);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open, prospectId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/api/chat/prospects/${prospectId}/call-log`, {
        method: 'POST',
        body: {
          call_type: callType,
          outcome,
          duration_seconds: (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
          notes,
        },
      });
      toast.success('Ligação registrada no prospect');
      setMinutes(''); setSeconds(''); setNotes('');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao registrar ligação');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Phone className="h-5 w-5 text-primary" /> Ligações — {prospectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={callType} onValueChange={setCallType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outgoing">Realizada</SelectItem>
                  <SelectItem value="incoming">Recebida</SelectItem>
                  <SelectItem value="missed">Perdida</SelectItem>
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
          <p className="text-xs text-muted-foreground">Contato: {prospectPhone || 'Não informado'}</p>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
            Registrar ligação
          </Button>

          <div className="space-y-2 border-t pt-3">
            <h4 className="font-medium">Histórico ({calls.length})</h4>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : calls.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ligação registrada.</p>
            ) : calls.map((call) => (
              <div key={call.id} className="rounded-lg border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={call.outcome === 'answered' ? 'default' : 'secondary'}>
                    {outcomeLabels[call.outcome] || call.outcome}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(call.created_at).toLocaleString('pt-BR')} · {durationLabel(Number(call.duration_seconds || 0))}
                  </span>
                </div>
                {call.notes && <p className="mt-1 text-xs">{call.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
