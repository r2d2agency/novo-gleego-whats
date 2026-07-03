import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { FileUploadInput } from '@/components/ui/file-upload-input';
import { PdfSignaturePositioner } from '@/components/doc-signatures/PdfSignaturePositioner';
import { useDocSignatures, DocSignatureDocument, DocSigner, AuditLog, SignaturePosition } from '@/hooks/use-doc-signatures';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  FileSignature, Plus, Loader2, Eye, Send, Copy, Trash2,
  UserPlus, FileText, Clock, CheckCircle2, XCircle, Shield, Download, Link2, Users, MapPin, CreditCard, ScanFace
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  draft: { label: 'Rascunho', variant: 'secondary', icon: FileText },
  pending: { label: 'Aguardando', variant: 'default', icon: Clock },
  completed: { label: 'Concluído', variant: 'outline', icon: CheckCircle2 },
  cancelled: { label: 'Cancelado', variant: 'destructive', icon: XCircle },
};

export default function Assinaturas() {
  const [documents, setDocuments] = useState<DocSignatureDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addSignerOpen, setAddSignerOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocSignatureDocument | null>(null);
  const [signers, setSigners] = useState<DocSigner[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [positions, setPositions] = useState<SignaturePosition[]>([]);
  const [activeTab, setActiveTab] = useState('signers');

  // Create form
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFileUrl, setNewFileUrl] = useState('');
  const [newRequireCnh, setNewRequireCnh] = useState(false);
  const [newRequireIdentity, setNewRequireIdentity] = useState(false);

  // Add signer form
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerCpf, setSignerCpf] = useState('');
  const [signerRole, setSignerRole] = useState('signer');
  const [signerPhone, setSignerPhone] = useState('');

  const { listDocuments, getDocument, createDocument, addSigner, removeSigner, sendForSignature, cancelDocument, savePositions, downloadSignedPdf, sendSigningLinkWhatsApp, loading: actionLoading } = useDocSignatures();

  useEffect(() => { loadDocuments(); }, []);

  const loadDocuments = async () => {
    setLoading(true);
    const docs = await listDocuments();
    setDocuments(docs);
    setLoading(false);
  };

  const loadDocumentDetail = async (docId: string) => {
    const data = await getDocument(docId);
    if (data) {
      setSelectedDoc(data.document);
      setSigners(data.signers);
      setAuditLogs(data.audit);
      setPositions(data.positions);
      setActiveTab('signers');
      setDetailOpen(true);
    }
  };

  const handleCreate = async () => {
    if (!newTitle || !newFileUrl) { toast.error('Título e arquivo são obrigatórios'); return; }
    try {
      await createDocument({ title: newTitle, description: newDescription, file_url: newFileUrl, require_cnh_validation: newRequireCnh, require_identity_validation: newRequireIdentity } as any);
      toast.success('Documento criado com sucesso!');
      setCreateOpen(false);
      setNewTitle(''); setNewDescription(''); setNewFileUrl(''); setNewRequireCnh(false); setNewRequireIdentity(false);
      loadDocuments();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddSigner = async () => {
    if (!selectedDoc) return;
    if (!signerName || !signerEmail || !signerCpf) { toast.error('Nome, email e CPF são obrigatórios'); return; }
    try {
      const phone = signerPhone.replace(/\D/g, '');
      await addSigner(selectedDoc.id, { name: signerName, email: signerEmail, cpf: signerCpf, role: signerRole, phone: phone || undefined } as any);
      toast.success('Signatário adicionado!');
      setAddSignerOpen(false);
      setSignerName(''); setSignerEmail(''); setSignerCpf(''); setSignerRole('signer'); setSignerPhone('');
      loadDocumentDetail(selectedDoc.id);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRemoveSigner = async (signerId: string) => {
    if (!selectedDoc) return;
    const ok = await removeSigner(selectedDoc.id, signerId);
    if (ok) { toast.success('Signatário removido'); loadDocumentDetail(selectedDoc.id); }
  };

  const handleSend = async () => {
    if (!selectedDoc) return;
    try {
      await sendForSignature(selectedDoc.id);
      toast.success('Documento enviado para assinatura!');
      loadDocumentDetail(selectedDoc.id);
      loadDocuments();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleCancel = async () => {
    if (!selectedDoc) return;
    const ok = await cancelDocument(selectedDoc.id);
    if (ok) { toast.success('Documento cancelado'); setDetailOpen(false); loadDocuments(); }
  };

  const handleSavePositions = async (newPositions: any[]) => {
    if (!selectedDoc) return;
    const ok = await savePositions(selectedDoc.id, newPositions);
    if (ok) {
      toast.success('Posições de assinatura salvas!');
      loadDocumentDetail(selectedDoc.id);
    } else {
      toast.error('Erro ao salvar posições');
    }
  };

  const handleDownload = async () => {
    if (!selectedDoc) return;
    const url = await downloadSignedPdf(selectedDoc.id);
    if (url) { window.open(url, '_blank'); }
    else { toast.error('Erro ao baixar documento'); }
  };

  const getSigningLink = (signer: DocSigner) => `${window.location.origin}/assinar/${signer.sign_token}`;
  const copySigningLink = (signer: DocSigner) => {
    navigator.clipboard.writeText(getSigningLink(signer));
    toast.success('Link copiado!');
  };

  const formatCpf = (value: string) => {
    const nums = value.replace(/\D/g, '').slice(0, 11);
    if (nums.length <= 3) return nums;
    if (nums.length <= 6) return `${nums.slice(0, 3)}.${nums.slice(3)}`;
    if (nums.length <= 9) return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6)}`;
    return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`;
  };

  const allSigned = (doc: DocSignatureDocument) => doc.signers_count > 0 && doc.signed_count === doc.signers_count;

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileSignature className="h-6 w-6 text-primary" />
              Assinaturas de Documentos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Envie documentos para assinatura digital com validade jurídica
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Documento
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: documents.length, icon: FileText, color: 'text-foreground' },
            { label: 'Aguardando', value: documents.filter(d => d.status === 'pending').length, icon: Clock, color: 'text-amber-500' },
            { label: 'Concluídos', value: documents.filter(d => d.status === 'completed').length, icon: CheckCircle2, color: 'text-green-500' },
            { label: 'Rascunhos', value: documents.filter(d => d.status === 'draft').length, icon: FileText, color: 'text-muted-foreground' },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className={`h-8 w-8 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Documents List */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileSignature className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Nenhum documento cadastrado</p>
                <p className="text-sm">Clique em "Novo Documento" para começar</p>
              </div>
            ) : (
              <>
              <div className="md:hidden divide-y divide-border">
                {documents.map((doc) => {
                  const status = statusConfig[doc.status] || statusConfig.draft;
                  const StatusIcon = status.icon;
                  const complete = allSigned(doc);
                  return (
                    <div key={doc.id} className="p-4 space-y-2 cursor-pointer active:bg-muted/50" onClick={() => loadDocumentDetail(doc.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{doc.title}</p>
                          {doc.creator_name && <p className="text-xs text-muted-foreground">por {doc.creator_name}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => loadDocumentDetail(doc.id)} title="Ver detalhes">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {doc.status === 'completed' && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                              const url = await downloadSignedPdf(doc.id);
                              if (url) window.open(url, '_blank');
                            }} title="Baixar documento">
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant={status.variant} className="gap-1 text-xs">
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: doc.signers_count > 0 ? `${(doc.signed_count / doc.signers_count) * 100}%` : '0%',
                                backgroundColor: complete ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium">
                            {doc.signed_count}/{doc.signers_count}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(new Date(doc.created_at), "dd/MM/yy", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Documento</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progresso</TableHead>
                      <TableHead>Criado em</TableHead>
                      <TableHead className="w-[120px]">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => {
                      const status = statusConfig[doc.status] || statusConfig.draft;
                      const StatusIcon = status.icon;
                      const complete = allSigned(doc);
                      return (
                        <TableRow key={doc.id} className="cursor-pointer" onClick={() => loadDocumentDetail(doc.id)}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{doc.title}</div>
                              {doc.creator_name && <div className="text-xs text-muted-foreground">por {doc.creator_name}</div>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: doc.signers_count > 0 ? `${(doc.signed_count / doc.signers_count) * 100}%` : '0%',
                                    backgroundColor: complete ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                                  }}
                                />
                              </div>
                              <span className="text-xs font-medium">
                                {doc.signed_count}/{doc.signers_count}
                                {complete && doc.status === 'completed' && <CheckCircle2 className="h-3 w-3 inline ml-1 text-green-500" />}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(doc.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" onClick={() => loadDocumentDetail(doc.id)} title="Ver detalhes">
                                <Eye className="h-4 w-4" />
                              </Button>
                              {doc.status === 'completed' && (
                                <Button variant="ghost" size="icon" onClick={async () => {
                                  const url = await downloadSignedPdf(doc.id);
                                  if (url) window.open(url, '_blank');
                                }} title="Baixar documento">
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Create Document Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Novo Documento para Assinatura</DialogTitle>
              <DialogDescription>Carregue um documento PDF para enviar para assinatura digital.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input placeholder="Ex: Contrato de Locação" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea placeholder="Descrição opcional do documento" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Arquivo PDF *</Label>
                <FileUploadInput value={newFileUrl} onChange={setNewFileUrl} accept=".pdf,application/pdf" placeholder="Faça upload do PDF" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Validação de CNH por IA</p>
                    <p className="text-xs text-muted-foreground">Exigir foto da habilitação para validar identidade do signatário</p>
                  </div>
                </div>
                <Switch checked={newRequireCnh} onCheckedChange={setNewRequireCnh} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <ScanFace className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Selfie + Documento (RG, CNH, CIN...)</p>
                    <p className="text-xs text-muted-foreground">Exigir selfie e foto do documento oficial. As imagens ficam salvas em Auditoria.</p>
                  </div>
                </div>
                <Switch checked={newRequireIdentity} onCheckedChange={setNewRequireIdentity} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={actionLoading}>
                {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar Documento
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Document Detail Dialog */}
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
            {selectedDoc && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileSignature className="h-5 w-5 text-primary" />
                    {selectedDoc.title}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-3 flex-wrap">
                    <span>{selectedDoc.description || 'Sem descrição'}</span>
                    <Badge variant={statusConfig[selectedDoc.status]?.variant || 'secondary'}>
                      {statusConfig[selectedDoc.status]?.label || selectedDoc.status}
                    </Badge>
                    <span className="text-xs">
                      Assinaturas: {selectedDoc.signed_count}/{selectedDoc.signers_count}
                      {allSigned(selectedDoc) && selectedDoc.status === 'completed' && ' ✅ Completo'}
                    </span>
                  </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="signers" className="gap-1"><Users className="h-3 w-3" /> Signatários</TabsTrigger>
                    <TabsTrigger value="positions" className="gap-1"><MapPin className="h-3 w-3" /> Posições</TabsTrigger>
                    <TabsTrigger value="links" className="gap-1"><Link2 className="h-3 w-3" /> Links</TabsTrigger>
                    <TabsTrigger value="audit" className="gap-1"><Shield className="h-3 w-3" /> Auditoria</TabsTrigger>
                  </TabsList>

                  {/* Signers Tab */}
                  <TabsContent value="signers" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{signers.length} signatário(s)</p>
                      {selectedDoc.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => setAddSignerOpen(true)} className="gap-1">
                          <UserPlus className="h-3 w-3" /> Adicionar
                        </Button>
                      )}
                    </div>
                    {signers.length === 0 ? (
                      <p className="text-center text-muted-foreground py-6">Nenhum signatário adicionado</p>
                    ) : (
                      <div className="space-y-2">
                        {signers.map((signer) => (
                          <div key={signer.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{signer.name}</p>
                                <Badge variant={signer.status === 'signed' ? 'default' : signer.status === 'declined' ? 'destructive' : 'secondary'} className="text-xs">
                                  {signer.status === 'signed' ? '✅ Assinado' : signer.status === 'declined' ? '❌ Recusado' : '⏳ Pendente'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{signer.email} • CPF: {signer.cpf}</p>
                              <Badge variant="outline" className="text-xs mt-1">
                                {signer.role === 'signer' ? 'Signatário' : signer.role === 'witness' ? 'Testemunha' : 'Aprovador'}
                              </Badge>
                              {signer.signed_at && (
                                <p className="text-xs text-green-600 mt-1">
                                  Assinado em: {format(new Date(signer.signed_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1">
                              {(selectedDoc.status === 'pending') && signer.status === 'pending' && (
                                <Button variant="outline" size="sm" onClick={() => copySigningLink(signer)} className="gap-1 text-xs">
                                  <Copy className="h-3 w-3" /> Copiar Link
                                </Button>
                              )}
                              {selectedDoc.status === 'draft' && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remover signatário?</AlertDialogTitle>
                                      <AlertDialogDescription>Remover {signer.name} do documento.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleRemoveSigner(signer.id)}>Remover</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* Positions Tab - PDF Viewer with drag & drop */}
                  <TabsContent value="positions" className="space-y-4">
                    {signers.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p>Adicione signatários antes de posicionar assinaturas</p>
                      </div>
                    ) : selectedDoc.file_url ? (
                      <PdfSignaturePositioner
                        fileUrl={selectedDoc.file_url}
                        signers={signers}
                        existingPositions={positions}
                        onSave={handleSavePositions}
                        readOnly={selectedDoc.status !== 'draft'}
                      />
                    ) : (
                      <p className="text-center text-muted-foreground py-8">Nenhum arquivo PDF encontrado</p>
                    )}
                  </TabsContent>

                  {/* Links Tab */}
                  <TabsContent value="links" className="space-y-4">
                    {selectedDoc.status === 'draft' ? (
                      <p className="text-center text-muted-foreground py-6">
                        Links ficam disponíveis após enviar o documento para assinatura
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {/* Per-signer links */}
                        {signers.map((signer) => (
                          <div key={signer.id} className="p-3 rounded-lg border space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{signer.name}</p>
                                <Badge variant={signer.status === 'signed' ? 'default' : 'secondary'} className="text-xs">
                                  {signer.status === 'signed' ? '✅ Assinado' : '⏳ Pendente'}
                                </Badge>
                              </div>
                              {signer.status === 'pending' && (
                                <Button size="sm" variant="outline" onClick={() => copySigningLink(signer)} className="gap-1">
                                  <Copy className="h-3 w-3" /> Copiar
                                </Button>
                              )}
                            </div>
                            {signer.status === 'pending' && (
                              <p className="text-xs text-muted-foreground break-all font-mono bg-muted p-2 rounded select-all">
                                {getSigningLink(signer)}
                              </p>
                            )}
                            {signer.status === 'signed' && signer.signed_at && (
                              <p className="text-xs text-green-600">
                                Assinado em {format(new Date(signer.signed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                {signer.ip_address && ` • IP: ${signer.ip_address}`}
                              </p>
                            )}
                          </div>
                        ))}

                        {/* General download */}
                        {selectedDoc.status === 'completed' && (
                          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
                            <CardContent className="p-4 flex items-center justify-between">
                              <div>
                                <p className="font-medium text-green-800 dark:text-green-200">✅ Todas as assinaturas concluídas!</p>
                                <p className="text-xs text-green-600 dark:text-green-400">Documento pronto para download</p>
                              </div>
                              <Button onClick={handleDownload} className="gap-1">
                                <Download className="h-4 w-4" /> Baixar PDF
                              </Button>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* Audit Tab */}
                  <TabsContent value="audit" className="space-y-2">
                    {/* Identity images captured per signer */}
                    {signers.some((s: any) => s.selfie_image_url || s.doc_front_image_url || s.doc_back_image_url) && (
                      <div className="mb-3 space-y-3">
                        <p className="text-xs font-medium uppercase text-muted-foreground">Registro de Identidade (Selfie + Documento)</p>
                        {signers.map((s: any) => {
                          if (!s.selfie_image_url && !s.doc_front_image_url && !s.doc_back_image_url) return null;
                          const buildUrl = (u?: string | null) => {
                            if (!u) return null;
                            return u.startsWith('http') ? u : `${window.location.origin}${u}`;
                          };
                          return (
                            <div key={s.id} className="p-3 rounded-lg border">
                              <p className="text-xs font-medium mb-2">👤 {s.name} ({s.email})</p>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { label: 'Selfie', url: buildUrl(s.selfie_image_url) },
                                  { label: 'Doc. Frente', url: buildUrl(s.doc_front_image_url) },
                                  { label: 'Doc. Verso', url: buildUrl(s.doc_back_image_url) },
                                ].map((img) => img.url ? (
                                  <a key={img.label} href={img.url} target="_blank" rel="noopener noreferrer" className="block">
                                    <img src={img.url} alt={img.label} className="w-full h-24 object-cover rounded border" />
                                    <p className="text-[10px] text-center text-muted-foreground mt-1">{img.label}</p>
                                  </a>
                                ) : null)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {auditLogs.length === 0 ? (
                      <p className="text-center text-muted-foreground py-6">Sem registros de auditoria</p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {auditLogs.map((log) => (
                          <div key={log.id} className="p-3 rounded-lg border text-sm">
                            <div className="flex items-center justify-between">
                              <Badge variant={
                                log.action === 'signature_submitted' ? 'default' :
                                log.action === 'otp_verified' ? 'default' :
                                log.action === 'document_completed' ? 'default' :
                                log.action === 'document_cancelled' ? 'destructive' :
                                'secondary'
                              } className="text-xs">
                                {{
                                  document_created: '📄 Documento Criado',
                                  document_sent: '📤 Enviado p/ Assinatura',
                                  otp_requested: '🔑 OTP Solicitado',
                                  otp_verified: '✅ Identidade Verificada',
                                  document_accessed: '👁️ Documento Acessado',
                                  signature_submitted: '✍️ Assinatura Registrada',
                                  document_completed: '🎉 Documento Finalizado',
                                  document_cancelled: '❌ Documento Cancelado',
                                  pdf_downloaded: '⬇️ PDF Baixado',
                                  positions_saved: '📐 Posições Salvas',
                                }[log.action] || log.action.replace(/_/g, ' ').toUpperCase()}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                              </span>
                            </div>
                            <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                              <p>👤 {log.actor_name || 'N/A'} ({log.actor_email || 'N/A'})</p>
                              {log.ip_address && <p>🌐 IP: {log.ip_address}</p>}
                              {log.user_agent && <p className="truncate max-w-full" title={log.user_agent}>🖥️ {log.user_agent.slice(0, 80)}{log.user_agent.length > 80 ? '…' : ''}</p>}
                              {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                                <p className="text-muted-foreground/70">
                                  {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>

                {/* Footer actions */}
                <div className="flex justify-between pt-4 border-t mt-4">
                  <div>
                    {selectedDoc.status === 'pending' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">Cancelar Documento</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancelar documento?</AlertDialogTitle>
                            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Voltar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCancel} className="bg-destructive hover:bg-destructive/90">Cancelar Documento</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {selectedDoc.status === 'completed' && (
                      <Button variant="outline" onClick={handleDownload} className="gap-1">
                        <Download className="h-4 w-4" /> Baixar Documento Final
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selectedDoc.status === 'pending' && signers.some((s: any) => s.phone && s.status === 'pending') && (
                      <Button variant="outline" onClick={async () => {
                        try {
                          const result = await sendSigningLinkWhatsApp(selectedDoc.id);
                          toast.success(`${result?.sent || 0} link(s) enviado(s) via WhatsApp!`);
                        } catch (err: any) { toast.error(err.message); }
                      }} className="gap-1" disabled={actionLoading}>
                        📱 Enviar via WhatsApp
                      </Button>
                    )}
                    {selectedDoc.status === 'draft' && signers.length > 0 && (
                      <Button onClick={handleSend} className="gap-1" disabled={actionLoading}>
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Enviar para Assinatura
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Signer Dialog */}
        <Dialog open={addSignerOpen} onOpenChange={setAddSignerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Adicionar Signatário</DialogTitle>
              <DialogDescription>Dados do signatário para validade jurídica.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome Completo *</Label>
                <Input placeholder="João da Silva" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" placeholder="joao@email.com" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>CPF *</Label>
                <Input placeholder="000.000.000-00" value={signerCpf} onChange={(e) => setSignerCpf(formatCpf(e.target.value))} maxLength={14} />
              </div>
              <div className="space-y-2">
                <Label>Papel</Label>
                <Select value={signerRole} onValueChange={setSignerRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="signer">Signatário</SelectItem>
                    <SelectItem value="witness">Testemunha</SelectItem>
                    <SelectItem value="approver">Aprovador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>WhatsApp (opcional)</Label>
                <Input placeholder="5511999999999" value={signerPhone} onChange={(e) => setSignerPhone(e.target.value.replace(/\D/g, ''))} maxLength={15} />
                <p className="text-xs text-muted-foreground">Informe para enviar o link de assinatura via WhatsApp</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddSignerOpen(false)}>Cancelar</Button>
              <Button onClick={handleAddSigner} disabled={actionLoading}>
                {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Adicionar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
