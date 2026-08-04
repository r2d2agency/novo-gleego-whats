import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, BellOff, Volume2, VolumeX, X, MessageSquare, FolderKanban, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { chatEvents } from "@/lib/chat-events";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { useProjectNoteNotifications, useProjectNoteNotificationMutations } from "@/hooks/use-projects";

interface UnreadConversation {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  unread_count: number;
  last_message: string | null;
  last_message_type: string | null;
  last_message_at: string | null;
  connection_name: string;
  connection_id?: string;
  attendance_status?: string | null;
  created_at?: string | null;
  is_group?: boolean;
}

function dedupeUnreadConversations(conversations: UnreadConversation[]): UnreadConversation[] {
  const byKey = new Map<string, UnreadConversation>();

  for (const conv of conversations) {
    const digits = (conv.contact_phone || '').replace(/\D/g, '');
    const last9 = digits.slice(-9);
    const key = last9 ? `${conv.connection_id || ''}:phone:${last9}` : conv.id;
    const existing = byKey.get(key);
    const existingTime = existing?.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
    const currentTime = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;

    if (!existing || currentTime >= existingTime) {
      byKey.set(key, {
        ...conv,
        unread_count: Math.max(conv.unread_count || 0, existing?.unread_count || 0),
      });
    }
  }

  return Array.from(byKey.values());
}

export function MessageNotifications() {
  const [unreadConversations, setUnreadConversations] = useState<UnreadConversation[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem("notification-sound-enabled");
    return saved !== "false";
  });
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("messages");
  const previousUnreadRef = useRef<number>(0);
  const previousConversationIdsRef = useRef<Set<string>>(new Set());
  const previousUnreadByConversationRef = useRef<Map<string, number>>(new Map());
  const isFetchingRef = useRef(false);
  
  const { playSound, playNewConversationSound, settings, isConnectionMuted, isConversationMuted, isGroupMuted } = useNotificationSound();

  // Project note notifications
  const { data: projectNotifications = [] } = useProjectNoteNotifications();
  const projectNotifMut = useProjectNoteNotificationMutations();
  const totalProjectNotifs = projectNotifications.length;
  const grandTotal = totalUnread + totalProjectNotifs;

  // Save sound preference
  useEffect(() => {
    localStorage.setItem("notification-sound-enabled", soundEnabled.toString());
  }, [soundEnabled]);

  // Fetch unread conversations
  const fetchUnreadConversations = useCallback(async (emitEvent = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const data = dedupeUnreadConversations(await api<UnreadConversation[]>("/api/chat/conversations/unread", {
        timeoutMs: 8000,
        retryCount: 0,
        allowBaseFallback: false,
      }));
      setUnreadConversations(data);
      
      const newTotal = data.reduce((sum, c) => sum + c.unread_count, 0);
      const currentIds = new Set(data.map(c => c.id));
      const previousUnreadByConversation = previousUnreadByConversationRef.current;
      
      // Check for brand new conversations (IDs that weren't in previous list)
      const newConversationIds = [...currentIds].filter(id => !previousConversationIdsRef.current.has(id));
      const hasNewConversations = newConversationIds.length > 0 && previousConversationIdsRef.current.size > 0;
      
      // Check if new conversations are from non-muted connections
      const hasUnmutedNewConversations = hasNewConversations && newConversationIds.some(id => {
        const conv = data.find(c => c.id === id);
        return conv
          && !isConnectionMuted(conv.connection_id)
          && !isConversationMuted(conv.id)
          && !isGroupMuted(conv.is_group, conv.id);
      });
      
      // Check for new unread count only in the conversations that actually increased.
      // Previously this used the global unread total and then checked if ANY unmuted
      // conversation had unread messages; that allowed a muted group increase to play
      // sound when another unmuted chat was already unread.
      const conversationsWithUnreadIncrease = data.filter(conv => {
        if (newConversationIds.includes(conv.id)) return false;
        const previousUnread = previousUnreadByConversation.get(conv.id) || 0;
        return (conv.unread_count || 0) > previousUnread;
      });
      const hasNewMessagesInExisting = conversationsWithUnreadIncrease.length > 0;
      
      // Check if new messages are from non-muted connections
      const hasUnmutedNewMessages = hasNewMessagesInExisting && conversationsWithUnreadIncrease.some(conv => {
        return conv.unread_count > 0
          && !isConnectionMuted(conv.connection_id)
          && !isConversationMuted(conv.id)
          && !isGroupMuted(conv.is_group, conv.id);
      });
      
      // Play appropriate sound
      if (soundEnabled && settings.soundEnabled && previousUnreadRef.current >= 0) {
        if (hasUnmutedNewConversations) {
          playNewConversationSound();
        } else if (hasUnmutedNewMessages && previousUnreadRef.current > 0) {
          playSound();
        }
      }
      
      // Broadcast to other components to refresh immediately
      if (emitEvent && (hasNewConversations || hasNewMessagesInExisting)) {
        chatEvents.emit('new_message');
      }
      
      previousConversationIdsRef.current = currentIds;
      previousUnreadByConversationRef.current = new Map(data.map(c => [c.id, c.unread_count || 0]));
      previousUnreadRef.current = newTotal;
      setTotalUnread(newTotal);
    } catch (error) {
      // Quiet fail - backend may be temporarily busy
    } finally {
      isFetchingRef.current = false;
    }
  }, [soundEnabled, settings.soundEnabled, playSound, playNewConversationSound, isConnectionMuted, isConversationMuted, isGroupMuted]);

  // Avoid request storms when the backend is under load.
  useEffect(() => {
    fetchUnreadConversations(false); // Initial fetch without event
    
    const interval = setInterval(() => fetchUnreadConversations(true), 10000);
    
    return () => clearInterval(interval);
  }, [fetchUnreadConversations]);

  // Clear notification for a conversation
  const handleClearNotification = async (conversationId: string) => {
    try {
      await api(`/api/chat/conversations/${conversationId}/read`, { method: "POST" });
      setUnreadConversations(prev => prev.filter(c => c.id !== conversationId));
      setTotalUnread(prev => {
        const conv = unreadConversations.find(c => c.id === conversationId);
        return Math.max(0, prev - (conv?.unread_count || 0));
      });
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  // Navigate to conversation
  const handleGoToConversation = (conversationId: string) => {
    setIsOpen(false);
    // Navigate to chat page - the conversation will be selected there
    window.location.href = `/chat?conversation=${conversationId}`;
  };

  const formatMessagePreview = (conv: UnreadConversation) => {
    if (!conv.last_message && !conv.last_message_type) return "Nova mensagem";
    
    if (conv.last_message_type === "audio") return "🎤 Áudio";
    if (conv.last_message_type === "image") return "📷 Imagem";
    if (conv.last_message_type === "video") return "🎥 Vídeo";
    if (conv.last_message_type === "document") return "📄 Documento";
    
    return conv.last_message?.slice(0, 50) || "Nova mensagem";
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
        >
          {grandTotal > 0 ? (
            <Bell className="h-5 w-5 text-primary animate-pulse" />
          ) : (
            <Bell className="h-5 w-5 text-muted-foreground" />
          )}
          {grandTotal > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 text-[10px] font-bold"
            >
              {grandTotal > 99 ? "99+" : grandTotal}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[calc(100vw-1rem)] max-w-80 p-0 mx-2 sm:mx-0 sm:w-80" 
        align="end"
        sideOffset={8}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between p-2 border-b">
            <TabsList className="h-8">
              <TabsTrigger value="messages" className="text-xs h-7 gap-1">
                <MessageSquare className="h-3 w-3" />
                Msgs {totalUnread > 0 && <Badge variant="secondary" className="text-[9px] px-1 h-4">{totalUnread}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="projects" className="text-xs h-7 gap-1">
                <FolderKanban className="h-3 w-3" />
                Projetos {totalProjectNotifs > 0 && <Badge variant="destructive" className="text-[9px] px-1 h-4">{totalProjectNotifs}</Badge>}
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Desativar som" : "Ativar som"}
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-primary" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
          </div>

          <TabsContent value="messages" className="mt-0">
            <ScrollArea className="max-h-[60vh] sm:max-h-[300px]">
              {unreadConversations.length === 0 ? (
                <div className="p-6 sm:p-4 text-center text-sm text-muted-foreground">
                  <BellOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Nenhuma mensagem não lida
                </div>
              ) : (
                <div className="divide-y">
                  {unreadConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="p-3 hover:bg-muted/50 cursor-pointer transition-colors group"
                      onClick={() => handleGoToConversation(conv.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <MessageSquare className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-sm truncate">
                              {conv.contact_name || conv.contact_phone || "Desconhecido"}
                            </p>
                            <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                              {conv.unread_count}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {formatMessagePreview(conv)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                              {conv.connection_name}
                            </span>
                            {conv.last_message_at && (
                              <>
                                <span className="text-[10px] text-muted-foreground">•</span>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  {format(new Date(conv.last_message_at), "HH:mm", { locale: ptBR })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearNotification(conv.id);
                          }}
                          title="Marcar como lida"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            {unreadConversations.length > 0 && (
              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => { setIsOpen(false); window.location.href = "/chat"; }}
                >
                  Ver todas as conversas
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects" className="mt-0">
            <ScrollArea className="max-h-[60vh] sm:max-h-[300px]">
              {projectNotifications.length === 0 ? (
                <div className="p-6 sm:p-4 text-center text-sm text-muted-foreground">
                  <FolderKanban className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Nenhuma notificação de projeto
                </div>
              ) : (
                <div className="divide-y">
                  {projectNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      className="p-3 hover:bg-muted/50 cursor-pointer transition-colors group"
                      onClick={() => {
                        projectNotifMut.markRead.mutate(notif.id);
                        setIsOpen(false);
                        window.location.href = "/projetos";
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <StickyNote className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{notif.project_title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="font-medium">{notif.sender_name}</span>: {notif.content_preview}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(notif.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            projectNotifMut.markRead.mutate(notif.id);
                          }}
                          title="Marcar como lida"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            {projectNotifications.length > 0 && (
              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => projectNotifMut.markAllRead.mutate()}
                >
                  Marcar todas como lidas
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
