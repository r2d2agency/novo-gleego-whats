import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Phone, PhoneCall, PhoneMissed, PhoneOff, Clock, Loader2, ExternalLink } from 'lucide-react';

interface CallLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string | null;
  contactPhone: string | null;
  deal?: { id: string; title: string } | null;
  onLogCall: (callData: {
    call_type: 'outgoing' | 'incoming' | 'missed';
    duration_seconds: number;
    outcome: string;
    notes: string;
    deal_id?: string | null;
  }) => Promise<void>;
  saving?: boolean;
}

export function CallLogDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
  deal,
  onLogCall,
  saving = false,
}: CallLogDialogProps) {
  const [callType, setCallType] = useState<'outgoing' | 'incoming' | 'missed'>('outgoing');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [callStarted, setCallStarted] = useState(false);

  const handleOpenWhatsApp = () => {
    if (!contactPhone) return;
    
    // Clean phone number (remove non-digits)
    const cleanPhone = contactPhone.replace(/\D/g, '');
    
    // Open WhatsApp call link
    // Note: wa.me doesn't support voice calls directly, 
    // but we can open the chat which allows the user to initiate a call
    const whatsappUrl = `https://wa.me/${cleanPhone}`;
    window.open(whatsappUrl, '_blank');
    setCallStarted(true);
  };

  const handleSubmit = async () => {
    const totalSeconds = (parseInt(durationMinutes) || 0) * 60 + (parseInt(durationSeconds) || 0);
    
    await onLogCall({
      call_type: callType,
      duration_seconds: totalSeconds,
      outcome: outcome || 'Sem resultado definido',
      notes,
      deal_id: deal?.id || null,
    });
    
    // Reset form
    setCallType('outgoing');
    setDurationMinutes('');
    setDurationSeconds('');
    setOutcome('');
    setNotes('');
    setCallStarted(false);
  };

  const outcomes = [
    { value: 'answered', label: 'Atendeu' },
    { value: 'voicemail', label: 'Caixa postal' },
    { value: 'no_answer', label: 'Não atendeu' },
    { value: 'busy', label: 'Ocupado' },
    { value: 'scheduled_callback', label: 'Retorno agendado' },
    { value: 'deal_closed', label: 'Negócio fechado' },
    { value: 'not_interested', label: 'Sem interesse' },
    { value: 'follow_up', label: 'Necessita follow-up' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Chamada de Voz
          </DialogTitle>
          <DialogDescription>
            Ligue para {contactName || contactPhone} via WhatsApp e registre o resultado
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {deal && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Será vinculada à negociação</p>
              <p className="font-medium">{deal.title}</p>
            </div>
          )}
          {/* Open WhatsApp Button */}
          {!callStarted && (
            <Button
              onClick={handleOpenWhatsApp}
              className="w-full h-12 text-lg gap-2"
              disabled={!contactPhone}
            >
              <PhoneCall className="h-5 w-5" />
              Abrir WhatsApp para Ligar
              <ExternalLink className="h-4 w-4 ml-1" />
            </Button>
          )}

          {callStarted && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
              <PhoneCall className="h-6 w-6 mx-auto mb-2 text-primary animate-pulse" />
              <p className="text-sm font-medium">WhatsApp aberto</p>
              <p className="text-xs text-muted-foreground">
                Faça a chamada e registre o resultado abaixo
              </p>
            </div>
          )}

          {/* Call Type */}
          <div className="space-y-2">
            <Label>Tipo de Chamada</Label>
            <Select value={callType} onValueChange={(v) => setCallType(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-green-500" />
                    Realizada (saída)
                  </div>
                </SelectItem>
                <SelectItem value="incoming">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-blue-500" />
                    Recebida (entrada)
                  </div>
                </SelectItem>
                <SelectItem value="missed">
                  <div className="flex items-center gap-2">
                    <PhoneMissed className="h-4 w-4 text-red-500" />
                    Perdida
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Duração
            </Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
                <span className="text-xs text-muted-foreground mt-1 block">minutos</span>
              </div>
              <span className="text-xl font-bold text-muted-foreground">:</span>
              <div className="flex-1">
                <Input
                  type="number"
                  min="0"
                  max="59"
                  placeholder="0"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value)}
                />
                <span className="text-xs text-muted-foreground mt-1 block">segundos</span>
              </div>
            </div>
          </div>

          {/* Outcome */}
          <div className="space-y-2">
            <Label>Resultado</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o resultado" />
              </SelectTrigger>
              <SelectContent>
                {outcomes.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Anotações</Label>
            <Textarea
              placeholder="Detalhes da conversa, próximos passos..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Registrar Chamada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
