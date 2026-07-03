import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileUploadInput } from '@/components/ui/file-upload-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useDocSignatures } from '@/hooks/use-doc-signatures';
import { toast } from 'sonner';
import { FileSignature, Loader2, Send, CreditCard, ScanFace } from 'lucide-react';

interface RequestSignatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName?: string;
  contactPhone?: string;
  dealId?: string;
}

export function RequestSignatureDialog({ open, onOpenChange, contactName, contactPhone, dealId }: RequestSignatureDialogProps) {
  const [step, setStep] = useState<'form' | 'signer'>('form');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [signerName, setSignerName] = useState(contactName || '');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerCpf, setSignerCpf] = useState('');
  const [signerRole, setSignerRole] = useState('signer');
  const [sending, setSending] = useState(false);
  const [requireCnh, setRequireCnh] = useState(false);
  const [requireIdentity, setRequireIdentity] = useState(false);

  const { createDocument, addSigner, sendForSignature, sendSigningLinkWhatsApp } = useDocSignatures();

  const formatCpf = (value: string) => {
    const nums = value.replace(/\D/g, '').slice(0, 11);
    if (nums.length <= 3) return nums;
    if (nums.length <= 6) return `${nums.slice(0, 3)}.${nums.slice(3)}`;
    if (nums.length <= 9) return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6)}`;
    return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`;
  };

  const resetForm = () => {
    setStep('form');
    setTitle('');
    setDescription('');
    setFileUrl('');
    setSignerName(contactName || '');
    setSignerEmail('');
    setSignerCpf('');
    setSignerRole('signer');
    setRequireCnh(false);
    setRequireIdentity(false);
  };

  const handleSubmit = async () => {
    if (!title || !fileUrl || !signerName || !signerEmail || !signerCpf) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    setSending(true);
    try {
      // 1. Create document
      const doc = await createDocument({ title, description, file_url: fileUrl, require_cnh_validation: requireCnh, require_identity_validation: requireIdentity, ...(dealId ? { deal_id: dealId } : {}) } as any);
      if (!doc) throw new Error('Erro ao criar documento');

      // 2. Add signer with phone
      const phone = contactPhone?.replace(/\D/g, '') || '';
      await addSigner(doc.id, {
        name: signerName,
        email: signerEmail,
        cpf: signerCpf,
        role: signerRole,
        phone: phone || undefined,
      } as any);

      // 3. Send for signature
      await sendForSignature(doc.id);

      // 4. Send link via WhatsApp if phone available
      if (phone) {
        try {
          const result = await sendSigningLinkWhatsApp(doc.id);
          if (result && result.sent > 0) {
            toast.success(`Documento enviado para assinatura e link enviado via WhatsApp!`);
          } else {
            toast.success('Documento enviado para assinatura! Link copiado para área de transferência.');
          }
        } catch {
          toast.success('Documento enviado para assinatura! Envio do link via WhatsApp falhou, use o link manual.');
        }
      } else {
        toast.success('Documento enviado para assinatura!');
      }

      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao solicitar assinatura');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            Solicitar Assinatura de Documento
          </DialogTitle>
          <DialogDescription>
            Envie um documento para {contactName || 'o contato'} assinar digitalmente via WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Document info */}
          <div className="space-y-2">
            <Label>Título do Documento *</Label>
            <Input placeholder="Ex: Contrato de Prestação de Serviços" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea placeholder="Descrição opcional..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Arquivo PDF *</Label>
            <FileUploadInput accept="application/pdf" onChange={(url) => setFileUrl(url)} value={fileUrl} previewType="file" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Validação de CNH</p>
                <p className="text-xs text-muted-foreground">Exigir foto da habilitação via IA</p>
              </div>
            </div>
            <Switch checked={requireCnh} onCheckedChange={setRequireCnh} />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-2">
              <ScanFace className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Validação de Identidade (Selfie + Documento)</p>
                <p className="text-xs text-muted-foreground">Exigir selfie e fotos do documento (frente/verso) analisados por IA</p>
              </div>
            </div>
            <Switch checked={requireIdentity} onCheckedChange={setRequireIdentity} />
          </div>
          {/* Signer info */}
          <div className="border-t pt-4">
            <h4 className="font-medium text-sm mb-3">Dados do Signatário</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome Completo *</Label>
                <Input placeholder="Nome" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input type="email" placeholder="email@exemplo.com" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CPF *</Label>
                <Input placeholder="000.000.000-00" value={signerCpf} onChange={(e) => setSignerCpf(formatCpf(e.target.value))} maxLength={14} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Papel</Label>
                <Select value={signerRole} onValueChange={setSignerRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="signer">Signatário</SelectItem>
                    <SelectItem value="witness">Testemunha</SelectItem>
                    <SelectItem value="approver">Aprovador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {contactPhone && (
              <p className="text-xs text-muted-foreground mt-2">
                📱 O link de assinatura será enviado automaticamente via WhatsApp para {contactPhone}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={sending || !title || !fileUrl || !signerName || !signerEmail || !signerCpf} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar para Assinatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
