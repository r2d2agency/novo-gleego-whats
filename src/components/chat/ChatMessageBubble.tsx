import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  FileText,
  Mic,
  Phone,
  Reply,
  RotateCcw,
  Pencil,
  Trash2,
  Pin,
  X,
  Send,
  Forward,
  UserPlus,
  Loader2,
  MessageSquarePlus,
  BookUser,
} from "lucide-react";

 import { format, isBefore, subHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/lib/media";
import { ChatMessage, Conversation } from "@/hooks/use-chat";
import { AudioPlayer } from "./AudioPlayer";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { LinkPreview } from "./LinkPreview";
import { SaveContactDialog } from "./SaveContactDialog";
import { RefreshCw } from "lucide-react";

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

const isWaMediaError = (content: string | null) => {
  if (!content) return false;
  const c = content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return (
    c.includes("audio nao esta mais disponivel") || 
    c.includes("midia nao esta mais disponivel") ||
    c.includes("não está mais disponível") ||
    c.includes("peça para reenvialo") ||
    c.includes("peca para reenvialo")
  );
};

function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) || [];
}


function renderTextWithLinks(text: string, searchQuery: string, highlightText: (t: string, q: string) => React.ReactNode): React.ReactNode {
  const parts = text.split(URL_REGEX);
  const urls = text.match(URL_REGEX) || [];
  
  if (urls.length === 0) {
    return searchQuery ? highlightText(text, searchQuery) : text;
  }

  const nodes: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) {
      nodes.push(searchQuery ? highlightText(part, searchQuery) : part);
    }
    if (i < urls.length) {
      nodes.push(
        <a
          key={`link-${i}`}
          href={urls[i]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:opacity-80 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {urls[i]}
        </a>
      );
    }
  });
  return nodes;
}

interface ChatMessageBubbleProps {
  msg: ChatMessage;
  conversation: Conversation;
  isMobile: boolean;
  isSearchResult: boolean;
  isCurrentResult: boolean;
  searchQuery: string;
  onReply: (msg: ChatMessage) => void;
  onForward?: (msg: ChatMessage) => void;
  onSendMessage: (content: string, type?: string, mediaUrl?: string, quotedMessageId?: string, mediaMimetype?: string) => Promise<void>;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  onPinMessage?: (messageId: string | null) => Promise<boolean>;
  isPinned?: boolean;
  onRetryMediaDownload?: (messageId: string) => Promise<boolean>;
  highlightText: (text: string, query: string) => React.ReactNode;
  getDocumentDisplayName: (msg: ChatMessage, resolvedUrl?: string | null) => string;
  looksLikeFilename: (value: string) => boolean;
  messageRef: (el: HTMLDivElement | null) => void;
  onStartConversation?: (contactName: string, contactPhone: string, connectionId: string) => void;
}


const messageStatusIcon = (status: string) => {
  switch (status) {
    case 'sent':
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-500" />;
    case 'pending':
      return <Clock className="h-3 w-3 text-muted-foreground animate-pulse" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-destructive" />;
    default:
      return null;
  }
};

export function ChatMessageBubble({
  msg,
  conversation,
  isMobile,
  isSearchResult,
  isCurrentResult,
  searchQuery,
  onReply,
  onForward,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onPinMessage,
  isPinned,
  onRetryMediaDownload,
  highlightText,
  getDocumentDisplayName,
  looksLikeFilename,
  messageRef,
  onStartConversation,
}: ChatMessageBubbleProps) {
  const mediaUrl = resolveMediaUrl(msg.media_url);
  const [isRetrying, setIsRetrying] = useState(false);
  const [saveContactOpen, setSaveContactOpen] = useState(false);

  const handleRetry = async () => {
    if (!onRetryMediaDownload || isRetrying) return;
    setIsRetrying(true);
    try {
      const ok = await onRetryMediaDownload(msg.message_id || msg.id);
      if (ok) {
        toast.success("Mídia recuperada com sucesso!");
      } else {
        toast.error("Não foi possível recuperar a mídia.");
      }
    } catch (err) {
      toast.error("Erro ao tentar recuperar mídia.");
    } finally {
      setIsRetrying(false);
    }
  };


  const handleDownload = async (e: React.MouseEvent, url: string, fileName: string) => {
    // If it's already a blob or data URL, let the default behavior happen
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const sanitizedFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    const triggerBlobDownload = (blob: Blob) => {
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = sanitizedFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
    };

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Network response was not ok');
      triggerBlobDownload(await response.blob());
    } catch (error) {
      console.warn('Direct download failed, trying backend proxy:', error);
      // Fallback: route through backend proxy to bypass CORS / force download
      try {
        const { API_URL } = await import('@/lib/api');
        const proxyUrl = `${API_URL}/api/uploads/proxy?url=${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error(`proxy ${resp.status}`);
        triggerBlobDownload(await resp.blob());
      } catch (proxyErr) {
        console.error('Proxy download failed:', proxyErr);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content || '');
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = msg.from_me && msg.message_type === 'text' && !msg.is_deleted && !!onEditMessage;
  const canDelete = msg.from_me && !msg.is_deleted && !!onDeleteMessage;

  const handleEdit = async () => {
    if (!editContent.trim() || !onEditMessage) return;
    setIsSaving(true);
    const ok = await onEditMessage(msg.id, editContent.trim());
    setIsSaving(false);
    if (ok) {
      toast.success("Mensagem editada");
      setIsEditing(false);
    } else {
      toast.error("Falha ao editar");
    }
  };

  const handleDelete = async () => {
    if (!onDeleteMessage) return;
    const ok = await onDeleteMessage(msg.id);
    if (ok) {
      toast.success("Mensagem apagada");
    } else {
      toast.error("Falha ao apagar");
    }
  };

  // Hide protocol/system messages that shouldn't be displayed
  if (msg.message_type === 'protocol' || (msg.content === '[protocol]' && !msg.media_url)) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      className={cn(
        "flex w-full min-w-0 group",
        msg.from_me ? "justify-end" : "justify-start"
      )}
    >
      {/* Action buttons - left side for received messages */}
      {!msg.from_me && msg.message_type !== 'system' && (
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-center mr-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onReply(msg)}
            title="Responder"
          >
            <Reply className="h-3 w-3" />
          </Button>
          {onForward && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onForward(msg)}
              title="Encaminhar"
            >
              <Forward className="h-3 w-3" />
            </Button>
          )}
          {onPinMessage && !msg.is_deleted && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", isPinned && "text-primary")}
              onClick={async () => {
                const ok = await onPinMessage(isPinned ? null : msg.id);
                if (ok) toast.success(isPinned ? "Mensagem desafixada" : "Mensagem fixada");
                else toast.error("Falha ao fixar mensagem");
              }}
              title={isPinned ? "Desafixar" : "Fixar mensagem"}
            >
              <Pin className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      <div
        className={cn(
          "rounded-lg transition-all overflow-hidden min-w-0",
          isMobile ? "max-w-[85%] p-2.5" : "max-w-[70%] p-3",
          msg.from_me ? "message-sent" : "message-received",
          msg.message_type === 'system' && "!bg-accent !text-accent-foreground text-center max-w-full text-xs italic",
          isSearchResult && "ring-2 ring-yellow-400",
          isCurrentResult && "ring-2 ring-yellow-500 bg-yellow-50 dark:bg-yellow-900/30",
          msg.status === 'failed' && "ring-2 ring-destructive bg-destructive/10"
        )}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {/* Sender name for group messages */}
        {conversation?.is_group && !msg.from_me && msg.sender_name && (
          <div className="text-xs font-semibold mb-1 text-primary">
            {msg.sender_name}
            {msg.sender_phone && (
              <span className="font-normal text-muted-foreground ml-1">
                ({msg.sender_phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')})
              </span>
            )}
          </div>
        )}

        {/* Forwarded indicator */}
        {msg.is_forwarded && !msg.from_me && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground italic mb-1">
            <Forward className="h-3 w-3" />
            <span>Encaminhada</span>
          </div>
        )}

        {/* Quoted message */}
        {msg.quoted_message_id && msg.quoted_content && (
          <div className={cn(
            "mb-2 p-2 rounded border-l-4 text-xs",
            msg.from_me 
              ? "bg-primary-foreground/10 border-primary-foreground/50" 
              : "bg-background/50 border-primary/50"
          )}>
            <div className="font-medium opacity-80 mb-0.5">
              <Reply className="h-3 w-3 inline mr-1" />
              {msg.quoted_from_me ? 'Você' : (msg.quoted_sender_name || 'Contato')}
            </div>
            <p className="line-clamp-2 opacity-70">
              {msg.quoted_message_type !== 'text' ? (
                <span className="italic">
                  {msg.quoted_message_type === 'image' && '📷 Imagem'}
                  {msg.quoted_message_type === 'video' && '🎥 Vídeo'}
                  {msg.quoted_message_type === 'audio' && '🎤 Áudio'}
                  {msg.quoted_message_type === 'document' && '📄 Documento'}
                </span>
              ) : msg.quoted_content}
            </p>
          </div>
        )}

        {/* Media content */}
        {(msg.message_type === 'image' || (msg.media_mimetype?.startsWith('image/') ?? false)) && mediaUrl && (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={mediaUrl}
              alt="Imagem recebida"
              loading="lazy"
              className="rounded max-w-full max-h-[300px] mb-2 cursor-pointer hover:opacity-90"
              crossOrigin="anonymous"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.className = 'flex items-center gap-2 text-sm opacity-70 mb-2 p-3 rounded bg-muted';
                fallback.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>Imagem não disponível</span>';
                target.parentElement?.appendChild(fallback);
              }}
            />
          </a>
        )}

        {(msg.message_type === 'video' || (msg.media_mimetype?.startsWith('video/') ?? false)) && mediaUrl && (
          <div className="mb-2">
            <video controls playsInline preload="none" className="rounded max-w-full max-h-[300px]" crossOrigin="anonymous">
              {msg.media_mimetype && <source src={mediaUrl} type={msg.media_mimetype} />}
              <source src={mediaUrl} type="video/mp4" />
              <source src={mediaUrl} type="video/webm" />
              Seu navegador não suporta vídeo.
            </video>
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline opacity-70 hover:opacity-100">
              Abrir vídeo
            </a>
          </div>
        )}

        {(msg.message_type === 'audio' || msg.message_type === 'ptt' || (msg.media_mimetype?.startsWith('audio/') ?? false)) && (
          mediaUrl ? (
            <div className="mb-2">
              <AudioPlayer src={mediaUrl} mimetype={msg.media_mimetype || undefined} isFromMe={msg.from_me} messageId={msg.id} savedTranscript={msg.transcript} />
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-background/30">
              <div className="flex items-center gap-2 text-sm opacity-70">
                <Mic className="h-4 w-4" />
                <span>Áudio não disponível</span>
              </div>
              {onRetryMediaDownload && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-[10px] w-full mt-1 border-primary/20 bg-background/50 hover:bg-background"
                  onClick={handleRetry}
                  disabled={isRetrying}
                >
                  {isRetrying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Tentar recuperar áudio
                </Button>
              )}
            </div>

          )
        )}

        {msg.message_type === 'sticker' && mediaUrl && (
          <img
            src={mediaUrl}
            alt="Sticker recebido"
            className="max-w-[150px] max-h-[150px] mb-2"
            crossOrigin="anonymous"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = 'none';
              const fallback = document.createElement('div');
              fallback.className = 'flex items-center gap-2 text-sm opacity-70 mb-2';
              fallback.innerHTML = '🎭 <span>Sticker não disponível</span>';
              target.parentElement?.appendChild(fallback);
            }}
          />
        )}

        {msg.message_type === 'document' && mediaUrl && (() => {
          const fileName = getDocumentDisplayName(msg, mediaUrl);
          return (
            <button
              type="button"
              className="flex items-center gap-2 text-sm underline mb-2 min-w-0 hover:opacity-80"
              onClick={(e) => handleDownload(e, mediaUrl, fileName)}
            >
              <FileText className="h-4 w-4" />
              <span className="truncate">{fileName}</span>
            </button>
          );
        })()}

        {/* Contact card (vCard) */}
        {msg.message_type === 'contact' && (() => {
          let contactName = '';
          let contactPhone = '';
          try {
            const parsed = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
            contactName = parsed?.contactName || parsed?.fullName || parsed?.name || '';
            contactPhone = parsed?.contactPhone || parsed?.phoneNumber || parsed?.phone || '';
          } catch {
            // try to parse vCard
            const raw = String(msg.content || '');
            const fnMatch = raw.match(/FN:(.+)/i);
            const telMatch = raw.match(/TEL[^:]*:([+\d\s-]+)/i);
            contactName = fnMatch?.[1]?.trim() || '';
            contactPhone = (telMatch?.[1] || '').replace(/\D/g, '');
          }
          const initials = (contactName || contactPhone || '?')
            .split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
          const vcardData = `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL:+${contactPhone}\nEND:VCARD`;
          const vcardUrl = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcardData)}`;
          return (
            <div className="bg-background/40 rounded-lg p-3 border border-border/50 mb-2 min-w-[220px]">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{contactName || 'Contato'}</p>
                  <p className="text-xs opacity-70 truncate">{contactPhone || '—'}</p>
                </div>
              </div>
              {contactPhone && (
                <div className="mt-2 flex flex-col border-t border-border/40 pt-1">
                  <button
                    type="button"
                    onClick={() => setSaveContactOpen(true)}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline py-1.5"
                  >
                    <BookUser className="h-3.5 w-3.5" />
                    Salvar contato
                  </button>
                  {onStartConversation && (
                    <button
                      type="button"
                      onClick={() => onStartConversation(contactName, contactPhone, conversation.connection_id)}
                      className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline py-1.5 border-t border-border/40"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      Iniciar conversa
                    </button>
                  )}
                  <a
                    href={vcardUrl}
                    download={`${(contactName || 'contato').replace(/\s+/g, '_')}.vcf`}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:underline py-1.5 border-t border-border/40"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Baixar vCard
                  </a>
                </div>
              )}
              <SaveContactDialog
                open={saveContactOpen}
                onOpenChange={setSaveContactOpen}
                contactName={contactName}
                contactPhone={contactPhone}
              />
            </div>
          );
        })()}

        {/* Call Log */}
        {msg.message_type === 'call_log' && (
          <div className="bg-background/50 rounded-lg p-3 border border-primary/20 mb-2">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Phone className="h-4 w-4" />
              <span className="font-medium text-sm">Registro de Chamada</span>
            </div>
            {msg.content && (
              <p className="text-sm whitespace-pre-wrap opacity-90" style={{ wordBreak: 'break-word' }}>
                {msg.content}
              </p>
            )}
          </div>
        )}

        {/* Text content */}
        {msg.is_deleted ? (
          <p className="text-sm whitespace-pre-wrap line-through opacity-50 italic" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {msg.content || '🚫 Mensagem apagada'}
          </p>
        ) : isEditing ? (
          <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="text-sm min-h-[40px] bg-background/50 border-primary/30"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleEdit();
                }
                if (e.key === 'Escape') setIsEditing(false);
              }}
            />
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
                disabled={isSaving}
              >
                <X className="h-3 w-3 mr-1" /> Cancelar
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); handleEdit(); }}
                disabled={isSaving || !editContent.trim()}
              >
                <Send className="h-3 w-3 mr-1" /> {isSaving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        ) : msg.content && msg.message_type !== 'call_log' && msg.message_type !== 'contact' && !(msg.message_type === 'document' && looksLikeFilename(msg.content)) ? (
          <>
            <p className="text-sm whitespace-pre-wrap" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
              {renderTextWithLinks(msg.content, searchQuery, highlightText)}
            </p>
            {extractUrls(msg.content).slice(0, 1).map((url) => (
              <LinkPreview key={url} url={url} savedPreview={msg.link_preview} />
            ))}
            {isWaMediaError(msg.content) && onRetryMediaDownload && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-[10px] w-full mt-2 border-primary/20 bg-background/50 hover:bg-background"
                onClick={handleRetry}
                disabled={isRetrying}
              >
                {isRetrying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Tentar recuperar áudio/mídia
              </Button>
            )}
          </>
        ) : null}


        {/* Timestamp and status */}
        <div className={cn(
          "flex items-center gap-1 mt-1",
          msg.from_me ? "justify-end" : "justify-start"
        )}>
          {msg.is_deleted && <span className="text-[10px] opacity-50 italic">🚫 apagada</span>}
          {msg.is_edited && !msg.is_deleted && <span className="text-[10px] opacity-50 italic">editada</span>}
           <span className="text-[10px] opacity-70">
             {isBefore(new Date(msg.timestamp), subHours(new Date(), 24))
               ? format(new Date(msg.timestamp), "dd/MM/yy HH:mm", { locale: ptBR })
               : format(new Date(msg.timestamp), "HH:mm", { locale: ptBR })}
           </span>
          {msg.from_me && messageStatusIcon(msg.status)}
        </div>

        {/* Failed message indicator with retry */}
        {msg.status === 'failed' && msg.from_me && (
          <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-destructive/30">
            {msg.error_message && (
              <span className="text-[10px] text-destructive/80 break-words">{msg.error_message}</span>
            )}
            <div className="flex items-center justify-end gap-2">
              <span className="text-[10px] text-destructive font-medium">Falha no envio</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={async () => {
                  try {
                    const retryContent = msg.content || (msg.message_type === 'document' ? getDocumentDisplayName(msg, mediaUrl) : '');
                    await onSendMessage(retryContent, msg.message_type, msg.media_url || undefined, msg.quoted_message_id || undefined, msg.media_mimetype || undefined);
                    toast.success("Mensagem reenviada!");
                  } catch {
                    toast.error("Falha ao reenviar");
                  }
                }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reenviar
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons - right side for sent messages */}
      {msg.from_me && msg.message_type !== 'system' && !msg.is_deleted && (
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-center ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onReply(msg)}
            title="Responder"
          >
            <Reply className="h-3 w-3" />
          </Button>
          {onForward && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onForward(msg)}
              title="Encaminhar"
            >
              <Forward className="h-3 w-3" />
            </Button>
          )}
          {onPinMessage && !msg.is_deleted && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", isPinned && "text-primary")}
              onClick={async () => {
                const ok = await onPinMessage(isPinned ? null : msg.id);
                if (ok) toast.success(isPinned ? "Mensagem desafixada" : "Mensagem fixada");
                else toast.error("Falha ao fixar mensagem");
              }}
              title={isPinned ? "Desafixar" : "Fixar mensagem"}
            >
              <Pin className="h-3 w-3" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setEditContent(msg.content || ''); setIsEditing(true); }}
              title="Editar"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:text-destructive"
              onClick={handleDelete}
              title="Apagar"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
      {msg.from_me && msg.message_type !== 'system' && msg.is_deleted && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onReply(msg)}
            title="Responder"
          >
            <Reply className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
