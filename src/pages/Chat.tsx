import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatArea } from "@/components/chat/ChatArea";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { CRMSidePanel } from "@/components/chat/CRMSidePanel";
 import { useChat, Conversation, ChatMessage, ConversationTag, TeamMember, Connection } from "@/hooks/use-chat";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { chatEvents } from "@/lib/chat-events";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Bell, ChevronLeft } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { useAuth } from "@/contexts/AuthContext";

interface UserProfile {
  user?: {
    role?: string;
  };
}

function dedupeConversations(conversations: Conversation[]): Conversation[] {
  const byKey = new Map<string, Conversation>();

  const getKey = (conv: Conversation) => {
    if (conv.is_group) return `${conv.connection_id}:group:${conv.remote_jid}`;
    const digits = (conv.contact_phone || conv.remote_jid || '').replace(/\D/g, '');
    const last9 = digits.slice(-9);
    return last9 ? `${conv.connection_id}:phone:${last9}` : `${conv.connection_id}:jid:${conv.remote_jid}`;
  };

  const score = (conv: Conversation) => {
    const statusScore = conv.attendance_status === 'attending' ? 3 : conv.attendance_status === 'waiting' ? 2 : 1;
    const unreadScore = Number(conv.unread_count || 0) > 0 ? 2 : 0;
    const messageScore = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
    return statusScore * 1_000_000_000_000_000 + unreadScore * 1_000_000_000_000 + messageScore;
  };

  for (const conv of conversations) {
    const key = getKey(conv);
    const existing = byKey.get(key);
    if (!existing || score(conv) > score(existing)) {
      byKey.set(key, conv);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bTime - aTime;
  });
}

function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const byExactId = new Set<string>();
  const byRecentSignature = new Map<string, ChatMessage>();

  for (const message of messages) {
    if (message.message_id && !message.message_id.startsWith('temp_')) {
      if (byExactId.has(message.message_id)) continue;
      byExactId.add(message.message_id);
    }

    const timestamp = message.timestamp ? new Date(message.timestamp).getTime() : 0;
    const bucket = timestamp ? Math.floor(timestamp / (3 * 60 * 1000)) : 0;
    const signature = [
      message.conversation_id,
      message.message_type || 'text',
      (message.content || '').trim(),
      message.media_url || '',
      bucket,
    ].join('|');

    if (message.from_me) {
      const existing = byRecentSignature.get(signature);
      if (existing) {
        const existingHasUser = Boolean(existing.sender_id);
        const currentHasUser = Boolean(message.sender_id);
        const existingIsTemp = !existing.message_id || existing.message_id.startsWith('temp_');
        const currentIsReal = Boolean(message.message_id && !message.message_id.startsWith('temp_'));
        const looksLikeWebhookEcho = existingHasUser !== currentHasUser || (existingIsTemp && currentIsReal);

        if (looksLikeWebhookEcho) {
          if ((currentHasUser && !existingHasUser) || (existingIsTemp && currentIsReal)) {
            const index = result.findIndex((item) => item.id === existing.id);
            if (index >= 0) result[index] = message;
            byRecentSignature.set(signature, message);
          }
          continue;
        }
      }

      byRecentSignature.set(signature, message);
    }

    result.push(message);
  }

  return result;
}

const Chat = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { modulesEnabled } = useAuth();
  const {
    loading,
    getConversations,
    getConversation,
    updateConversation,
    markAsRead,
    deleteConversation,
    transferConversation,
    pinConversation,
    favoriteConversation,
    muteConversation,
    acceptConversation,
    releaseConversation,
    finishConversation,
    reopenConversation,
    getConnections,
    getMessages,
    sendMessage,
    getTags,
    createTag,
    addTagToConversation,
    removeTagFromConversation,
    getTeam,
    syncChatHistory,
    syncGroupName,
    syncAllGroupNames,
    startAlertsPolling,
    stopAlertsPolling,
    getAttendanceCounts,
  } = useChat();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tags, setTags] = useState<ConversationTag[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
   const [connections, setConnections] = useState<Connection[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  
   const [loadingMessages, setLoadingMessages] = useState(false);
   const [historyDays, setHistoryDays] = useState(() => {
     const saved = localStorage.getItem('chat-history-days');
     return saved ? parseInt(saved) : 30;
   });
  const [sendingMessage, setSendingMessage] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncingGroups, setSyncingGroups] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [crmPanelOpen, setCrmPanelOpen] = useState(false);

  // Escape to close CRM panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && crmPanelOpen) {
        setCrmPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [crmPanelOpen]);

  const [attendanceCounts, setAttendanceCounts] = useState<{ waiting: number; attending: number; finished: number }>({ waiting: 0, attending: 0, finished: 0 });
  const [filters, setFilters] = useState(() => {
    const savedConnection = localStorage.getItem('chat_selected_connection') || 'all';
    return {
      search: '',
      tag: 'all',
      assigned: 'all',
      archived: false,
      connection: savedConnection,
      is_group: false,
      attendance_status: 'attending' as 'waiting' | 'attending' | 'finished',
      department: 'all',
      favorite: false,
      startDate: undefined as string | undefined,
      endDate: undefined as string | undefined,
    };
  });
  const [activeTab, setActiveTab] = useState<'chats' | 'groups'>('chats');
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);

  // Keep latest loader for intervals / effects without stale closures
  const loadConversationsRef = useRef<() => void>(() => {});
  // Keep a just-created "empty" conversation visible until it has messages
  const stickyConversationRef = useRef<Conversation | null>(null);
  // Prevent race conditions during conversation loading
  const isLoadingConversationsRef = useRef(false);
  // Track the currently selected conversation ID to prevent stale updates
  const selectedIdRef = useRef<string | null>(null);
  // Track previous waiting count to detect new arrivals
  const prevWaitingCountRef = useRef<number>(0);

  // Notification sound hook
  const { notify, settings, pushPermission } = useNotificationSound();

  // Load initial data and start alerts polling
  useEffect(() => {
    loadConversations();
    loadTags();
    loadTeam();
    loadConnections();
    loadAttendanceCounts();
    checkUserRole();
    startAlertsPolling();

    return () => {
      stopAlertsPolling();
    };
  }, []);

  // Load attendance counts and notify if new waiting conversations
  const loadAttendanceCounts = useCallback(async () => {
    const isGroup = activeTab === 'groups';
    const counts = await getAttendanceCounts(isGroup);
    
    // Check if waiting count increased (new conversation arrived)
    if (counts.waiting > prevWaitingCountRef.current && prevWaitingCountRef.current > 0 && !(isGroup && settings.muteGroups)) {
      const newCount = counts.waiting - prevWaitingCountRef.current;
      const message = newCount === 1 
        ? 'Nova conversa aguardando atendimento!' 
        : `${newCount} novas conversas aguardando atendimento!`;
      
      // Use notify() which handles both sound AND push notification
      notify(
        '🔔 Glee-go Whats', 
        message,
        { playSound: true }
      );
      
      // Also show in-app toast
      toast.info(`🔔 ${message}`, {
        duration: 5000,
        icon: <Bell className="h-4 w-4 text-amber-500" />,
      });
    }
    
    // Update ref for next comparison
    prevWaitingCountRef.current = counts.waiting;
    setAttendanceCounts(counts);
  }, [activeTab, getAttendanceCounts, notify, settings.muteGroups]);

  const checkUserRole = async () => {
    try {
      const profile = await api<UserProfile>('/api/auth/me');
      const role = profile.user?.role || '';
      setUserRole(role);
      setIsAdmin(['owner', 'admin'].includes(role));
    } catch (error) {
      console.error('Error checking user role:', error);
    }
  };

  // Auto-refresh conversations (less frequent on mobile)
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversationsRef.current();
    }, isMobile ? 30000 : 15000);
    return () => clearInterval(interval);
  }, [isMobile]);

  // Poll for new waiting conversations (less frequent on mobile)
  useEffect(() => {
    const interval = setInterval(() => {
      loadAttendanceCounts();
    }, isMobile ? 20000 : 10000);
    return () => clearInterval(interval);
  }, [loadAttendanceCounts, isMobile]);

  // Subscribe to chat events for immediate updates
  useEffect(() => {
    const unsubscribe = chatEvents.subscribe('new_message', () => {
      loadConversationsRef.current();
      if (selectedConversation) {
        getMessages(selectedConversation.id).then((msgs) => setMessages(dedupeMessages(msgs))).catch(console.error);
      }
    });
    return unsubscribe;
  }, [selectedConversation, getMessages]);

   // Listen for refresh-conversations event
   useEffect(() => {
     const handleRefresh = () => { loadConversationsRef.current(); };
     const handleRefreshHistory = (e: any) => {
       if (e.detail?.days) {
         setHistoryDays(e.detail.days);
       }
     };
     window.addEventListener('refresh-conversations', handleRefresh);
     window.addEventListener('refresh-history-days', handleRefreshHistory);
     return () => {
       window.removeEventListener('refresh-conversations', handleRefresh);
       window.removeEventListener('refresh-history-days', handleRefreshHistory);
     };
   }, []);

   // Auto-refresh messages (less frequent on mobile to save bandwidth)
   useEffect(() => {
     if (!selectedConversation) return;
     const interval = setInterval(async () => {
       try {
          const msgs = dedupeMessages(await getMessages(selectedConversation.id));
         
         setMessages(prev => {
           // If we have more messages in the state than the initial fetch (due to infinite scroll),
           // we should merge the updates instead of overwriting the whole list,
           // which would cause the scroll to jump back to the bottom.
            if (Array.isArray(msgs) && prev.length > msgs.length) {
              // Simple strategy: only update the common messages at the end
              const commonCount = msgs.length;
             const baseMessages = prev.slice(0, prev.length - commonCount);
              return dedupeMessages([...baseMessages, ...msgs]);
           }
           return msgs;
         });
       } catch (error) {
         console.error('Error refreshing messages:', error);
       }
     }, isMobile ? 8000 : 3000);
     return () => clearInterval(interval);
   }, [selectedConversation?.id, getMessages, isMobile]);

   const loadConnections = useCallback(async () => {
     try {
       console.log('[Chat] Loading connections...');
       const data = await getConnections();
       console.log('[Chat] Connections loaded:', data);
       setConnections(data);
     } catch (error) {
       console.error('[Chat] Error loading connections:', error);
     }
   }, [getConnections]);

  // Listener for local conversation updates
  useEffect(() => {
    const handleLocalUpdate = (event: any) => {
      const { id, contact_name } = event.detail;
      setConversations(prev => prev.map(c => c.id === id ? { ...c, contact_name } : c));
      setSelectedConversation(prev => (prev?.id === id ? { ...prev, contact_name } : prev));
    };

    window.addEventListener('update-conversation-local', handleLocalUpdate);
    return () => window.removeEventListener('update-conversation-local', handleLocalUpdate);
  }, []);

  const loadConversations = useCallback(async (isLoadMore = false) => {
    // Prevent overlapping loads unless it's a load more
    if (!isLoadMore && isLoadingConversationsRef.current) return;
    if (isLoadMore && loadingMoreConversations) return;

    if (isLoadMore) {
      setLoadingMoreConversations(true);
    } else {
      isLoadingConversationsRef.current = true;
    }

    try {
      const limit = 50;
      const offset = isLoadMore ? conversations.length : 0;

      const filterParams: any = {};
      if (filters.search) filterParams.search = filters.search;
      if (filters.tag !== 'all') filterParams.tag = filters.tag;
      if (filters.assigned !== 'all') filterParams.assigned = filters.assigned;
      if (filters.connection !== 'all') filterParams.connection = filters.connection;
      if (filters.department !== 'all') filterParams.department = filters.department;
      filterParams.archived = filters.archived;
      filterParams.is_group = activeTab === 'groups' ? 'true' : 'false';
      filterParams.attendance_status = filters.attendance_status;
      if (filters.favorite) filterParams.favorite = 'true';
      if (filters.startDate) filterParams.startDate = filters.startDate;
      if (filters.endDate) filterParams.endDate = filters.endDate;
      
      filterParams.limit = limit;
      filterParams.offset = offset;

      const data = dedupeConversations(await getConversations(filterParams));
      setHasMoreConversations(Array.isArray(data) && data.length === limit);

      const sticky = stickyConversationRef.current;

      // Merge in "empty" conversations we want to keep visible
      let merged = isLoadMore ? [...conversations, ...data] : data;
      
      // Keep sticky conversation visible if it has no messages yet
      if (sticky && !sticky.last_message_at && !merged.some(c => c.id === sticky.id)) {
        merged = [sticky, ...merged];
      }

      setConversations(dedupeConversations(merged));

      // Clear sticky once it is naturally returned by the backend (or has messages)
      if (sticky && (sticky.last_message_at || data.some(c => c.id === sticky.id))) {
        stickyConversationRef.current = null;
      }

      // Update selected conversation if it exists (only if ID matches to avoid race conditions)
      const currentSelectedId = selectedIdRef.current;
      if (currentSelectedId) {
        const updated = merged.find(c => c.id === currentSelectedId);
        if (updated) {
          setSelectedConversation(prev => {
            // Only update if it's still the same conversation
            if (prev?.id === currentSelectedId) {
              return updated;
            }
            return prev;
          });
        }
      }

      // Also refresh attendance counts
      loadAttendanceCounts();
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      if (isLoadMore) {
        setLoadingMoreConversations(false);
      } else {
        isLoadingConversationsRef.current = false;
      }
    }
  }, [getConversations, filters, activeTab, loadAttendanceCounts, conversations.length, loadingMoreConversations]);

  // Keep ref pointing to the latest loadConversations (used by intervals above)
  useEffect(() => {
    loadConversationsRef.current = loadConversations;
  }, [loadConversations]);

  // Persist selected connection filter
  useEffect(() => {
    localStorage.setItem('chat_selected_connection', filters.connection);
  }, [filters.connection]);

  // Reload immediately when filters or activeTab change
  // Note: loadConversations deps are now stable so this only triggers on actual filter changes
  useEffect(() => {
    loadConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.tag, filters.assigned, filters.connection, filters.archived, filters.attendance_status, filters.department, filters.favorite, filters.startDate, filters.endDate, activeTab]);

  // Clear the list instantly when switching between chats/groups so the UI
  // doesn't keep showing the previous tab's conversations while loading
  useEffect(() => {
    setConversations([]);
    setHasMoreConversations(false);
  }, [activeTab]);

  const loadTags = async () => {
    try {
      const data = await getTags();
      setTags(data);
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  const loadTeam = async () => {
    try {
      const data = await getTeam();
      setTeam(data);
    } catch (error) {
      console.error('Error loading team:', error);
    }
  };

  const handleSelectConversation = useCallback(async (conversation: Conversation) => {
    // Update the ref immediately to prevent race conditions
    selectedIdRef.current = conversation.id;
    
    setSelectedConversation(conversation);
    setMessages([]);
    setLoadingMessages(true);

    try {
      // Check if we're still looking at the same conversation
      if (selectedIdRef.current !== conversation.id) {
        return; // User switched to another conversation
      }
      
      const msgs = dedupeMessages(await getMessages(conversation.id, { 
        days: historyDays,
        limit: 500 // Increased limit to match sync capacity
      }));
      
      // Verify again after async call
      if (selectedIdRef.current !== conversation.id) {
        return; // User switched to another conversation
      }
      
      setMessages(msgs);
      setHasMoreMessages(msgs.length >= 500);

      // Mark as read
      if (conversation.unread_count > 0) {
        await markAsRead(conversation.id);
        // Don't call loadConversations here to avoid loop - it will be refreshed by interval
      }

      // For groups without a name, try to sync from W-API
      if (conversation.is_group && !conversation.group_name) {
        syncGroupName(conversation.connection_id, conversation.id).then(result => {
          // Verify we're still on the same conversation
          if (selectedIdRef.current !== conversation.id) return;
          
          if (result.success && result.group_name) {
            // Update the conversation locally
            setSelectedConversation(prev => 
              prev?.id === conversation.id 
                ? { ...prev, group_name: result.group_name } 
                : prev
            );
            setConversations(prev => 
              prev.map(c => 
                c.id === conversation.id 
                  ? { ...c, group_name: result.group_name } 
                  : c
              )
            );
          }
        }).catch(console.error);
      }
    } catch (error) {
      // Only show error if we're still on the same conversation
      if (selectedIdRef.current === conversation.id) {
        console.error('Error loading messages:', error);
        toast.error('Erro ao carregar mensagens');
      }
    } finally {
      // Only update loading state if we're still on the same conversation
      if (selectedIdRef.current === conversation.id) {
        setLoadingMessages(false);
      }
    }
  }, [getMessages, markAsRead, syncGroupName]);

  // If we arrive from the Agenda (or any deep link): /chat?conversation=<id> or /chat?phone=<phone>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const conversationId = params.get('conversation');
    const phone = params.get('phone');
    
    if (!conversationId && !phone) return;

    (async () => {
      try {
        let conv: Conversation;
        
        if (conversationId) {
          conv = await getConversation(conversationId);
        } else if (phone) {
          // Fetch conversation by phone number
          conv = await api<Conversation>(`/api/chat/conversations/by-phone/${encodeURIComponent(phone)}`);
        } else {
          return;
        }
        
        // Auto-switch attendance tab to match conversation's status
        const convStatus = (conv as any).attendance_status;
        const mappedStatus = convStatus === 'waiting' ? 'waiting' 
          : convStatus === 'finished' ? 'finished' 
          : 'attending';
        
        // Auto-switch group/chat tab
        const isGroup = !!(conv as any).is_group;
        const newActiveTab = isGroup ? 'groups' : 'chats';
        
        // Update filters and tab synchronously
        if (mappedStatus !== filters.attendance_status || newActiveTab !== activeTab) {
          setFilters(prev => ({ ...prev, attendance_status: mappedStatus }));
          setActiveTab(newActiveTab);
          
          // Force reload conversations with correct filters after a tick
          // This bypasses the race condition where initial load blocks the filter-triggered reload
          setTimeout(() => {
            isLoadingConversationsRef.current = false; // Reset guard
            loadConversationsRef.current();
          }, 300);
        }
        
        await handleSelectConversation(conv);
      } catch (error) {
        console.error('Error opening conversation from URL:', error);
        toast.error('Não foi possível abrir a conversa');
      }
    })();
  }, [location.search, getConversation, handleSelectConversation]);

  const handleLoadMoreMessages = async () => {
    if (!selectedConversation || messages.length === 0) return;

    setLoadingMessages(true);
    try {
      const oldestMessage = messages[0];
      // When loading older messages, we should probably ignore the days filter
      // or ensure the backend doesn't combine before + days in a way that returns nothing
      const olderMsgs = dedupeMessages(await getMessages(selectedConversation.id, {
        before: oldestMessage.timestamp,
        limit: 500,
      }));
      
      setMessages(dedupeMessages([...olderMsgs, ...messages]));
      setHasMoreMessages(olderMsgs.length >= 500);
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (
    content: string,
    type: string = 'text',
    mediaUrl?: string,
    quotedMessageId?: string,
    mediaMimetype?: string,
    duration?: number
  ) => {
    if (!selectedConversation) return;

    setSendingMessage(true);
    try {
      const newMessage = await sendMessage(selectedConversation.id, {
        content,
        message_type: type,
        media_url: mediaUrl,
        media_mimetype: mediaMimetype,
        quoted_message_id: quotedMessageId,
        duration,
      });
      
      setMessages(prev => dedupeMessages([...prev, newMessage]));
      loadConversations(); // Refresh to update last_message
    } catch (error: any) {
      const failedMessage = error?.response?.message as ChatMessage | undefined;
      if (failedMessage?.id) {
        setMessages(prev => dedupeMessages([...prev.filter(m => m.id !== failedMessage.id), failedMessage]));
      }
      toast.error(error.message || 'Erro ao enviar mensagem');
      throw error;
    } finally {
      setSendingMessage(false);
    }
  };

  const handleForwardMessage = async (targetConversationId: string, message: ChatMessage) => {
    try {
      await sendMessage(targetConversationId, {
        content: message.content || undefined,
        message_type: message.message_type,
        media_url: message.media_url || undefined,
        media_mimetype: message.media_mimetype || undefined,
        is_forwarded: true,
      });
      toast.success('Mensagem encaminhada!');
      loadConversations();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao encaminhar mensagem');
      throw error;
    }
  };

  const handleAddTag = async (tagId: string) => {
    if (!selectedConversation) return;
    try {
      await addTagToConversation(selectedConversation.id, tagId);
      loadConversations();
      toast.success('Tag adicionada');
    } catch (error) {
      toast.error('Erro ao adicionar tag');
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    if (!selectedConversation) return;
    try {
      await removeTagFromConversation(selectedConversation.id, tagId);
      loadConversations();
      toast.success('Tag removida');
    } catch (error) {
      toast.error('Erro ao remover tag');
    }
  };

  const handleAssign = async (userId: string | null) => {
    if (!selectedConversation) return;
    try {
      await updateConversation(selectedConversation.id, { assigned_to: userId });
      loadConversations();
      toast.success(userId ? 'Atendente atribuído' : 'Atendente removido');
    } catch (error) {
      toast.error('Erro ao atribuir atendente');
    }
  };

  const handleArchive = async () => {
    if (!selectedConversation) return;
    try {
      const newArchived = !selectedConversation.is_archived;
      await updateConversation(selectedConversation.id, { is_archived: newArchived });
      loadConversations();
      selectedIdRef.current = null; // Clear ref when archiving
      setSelectedConversation(null);
      setMessages([]);
      toast.success(newArchived ? 'Conversa arquivada' : 'Conversa desarquivada');
    } catch (error) {
      toast.error('Erro ao arquivar conversa');
    }
  };

  const handleTransfer = async (userId: string | null, note?: string) => {
    if (!selectedConversation) return;
    try {
      await transferConversation(selectedConversation.id, userId, note);
      loadConversations();
      
      // Reload messages to show transfer system message
       const msgs = await getMessages(selectedConversation.id, { days: historyDays });
      setMessages(msgs);
    } catch (error) {
      toast.error('Erro ao transferir conversa');
    }
  };

  const handleCreateTag = async (name: string, color: string) => {
    try {
      const newTag = await createTag(name, color);
      setTags(prev => [...prev, newTag]);
      toast.success('Tag criada');

      // Also add to current conversation
      if (selectedConversation) {
        await addTagToConversation(selectedConversation.id, newTag.id);
        loadConversations();
      }
    } catch (error) {
      toast.error('Erro ao criar tag');
    }
  };

  const handleSyncHistory = async (days: number) => {
    if (!selectedConversation) return;
    setSyncingHistory(true);
     try {
       const connection = connections.find(c => c.id === selectedConversation.connection_id);
       const result = await syncChatHistory({
         connectionId: selectedConversation.connection_id,
         remoteJid: selectedConversation.remote_jid,
         days,
         provider: connection?.provider,
       });

      // Refresh messages and conversations
      const msgs = await getMessages(selectedConversation.id);
      setMessages(msgs);
      loadConversations();

      toast.success(result.message || `Sincronizado (${result.imported} mensagens)`);
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao sincronizar histórico');
    } finally {
      setSyncingHistory(false);
    }
  };

  const handleAcceptConversation = async (conversationId: string) => {
    try {
      await acceptConversation(conversationId);
      // Switch to 'attending' tab so the accepted conversation is visible
      if (filters.attendance_status !== 'attending') {
        setFilters(prev => ({ ...prev, attendance_status: 'attending' }));
      }
      await loadConversations();
      // Auto-open the conversation after accepting
      try {
        const conv = await getConversation(conversationId);
        if (conv) {
          await handleSelectConversation(conv);
        }
      } catch (e) {
        console.warn('[accept] failed to auto-open conversation', e);
      }
      toast.success('Conversa aceita');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao aceitar conversa');
    }
  };

  const handleReleaseConversation = async () => {
    if (!selectedConversation) return;
    try {
      await releaseConversation(selectedConversation.id);
      selectedIdRef.current = null;
      setSelectedConversation(null);
      setMessages([]);
      loadConversations();
      toast.success('Conversa liberada para aguardando');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao liberar conversa');
    }
  };

  const handleFinishConversation = async (conversationId?: string) => {
    const id = conversationId || selectedConversation?.id;
    if (!id) return;
    try {
      await finishConversation(id);
      if (id === selectedConversation?.id) {
        selectedIdRef.current = null;
        setSelectedConversation(null);
        setMessages([]);
      }
      loadConversations();
      toast.success('Conversa finalizada');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao finalizar conversa');
    }
  };

  const handleReopenConversation = async (conversationId?: string) => {
    const id = conversationId || selectedConversation?.id;
    if (!id) return;
    try {
      await reopenConversation(id);
      if (id === selectedConversation?.id) {
        selectedIdRef.current = null;
        setSelectedConversation(null);
        setMessages([]);
      }
      loadConversations();
      toast.success('Conversa reaberta para aguardando');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao reabrir conversa');
    }
  };

  const handleNewConversationCreated = async (conversation: Conversation) => {
    // Keep it visible even if it has no messages yet
    stickyConversationRef.current = conversation;

    // Add to list immediately
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== conversation.id);
      return [conversation, ...filtered];
    });

    // Load full conversation data and select it properly
    try {
      const fullConversation = await getConversation(conversation.id);
      if (fullConversation) {
        stickyConversationRef.current = fullConversation;
        await handleSelectConversation(fullConversation);
      } else {
        await handleSelectConversation(conversation);
      }
    } catch (error) {
      console.error('Error loading new conversation:', error);
      selectedIdRef.current = conversation.id;
      setSelectedConversation(conversation);
      setMessages([]);
    }

    // Refresh list (will keep sticky if backend still hides empties)
    loadConversationsRef.current();
  };

  // Mobile: go back to conversation list
  const handleMobileBack = () => {
    selectedIdRef.current = null;
    setSelectedConversation(null);
    setMessages([]);
  };

  // Mobile-aware conversation selection
  const handleMobileSelectConversation = useCallback(async (conversation: Conversation) => {
    await handleSelectConversation(conversation);
  }, [handleSelectConversation]);

  // Sync all group names for W-API connections
  const handleSyncAllGroups = async () => {
    setSyncingGroups(true);
    try {
      // Get all W-API connections
      const wapiConnections = connections.filter(c => c.status === 'connected');
      let totalUpdated = 0;
      let totalGroups = 0;

      for (const conn of wapiConnections) {
        try {
          const result = await syncAllGroupNames(conn.id);
          if (result.success) {
            totalUpdated += result.updated || 0;
            totalGroups += result.total || 0;
          }
        } catch (e) {
          console.error('Error syncing groups for connection:', conn.id, e);
        }
      }

      if (totalUpdated > 0) {
        toast.success(`${totalUpdated} grupos atualizados`);
        loadConversations();
      } else if (totalGroups === 0) {
        toast.info('Nenhum grupo sem nome encontrado');
      } else {
        toast.info('Não foi possível obter nomes dos grupos');
      }
    } catch (error) {
      toast.error('Erro ao sincronizar grupos');
    } finally {
      setSyncingGroups(false);
    }
  };

  return (
    <MainLayout>
      {/* Mobile: full viewport height minus safe areas; Desktop: calc with padding */}
      <div className={cn(
        "flex flex-col rounded-lg border bg-background shadow-lg",
        isMobile 
          ? "h-[100dvh] w-full fixed inset-0 z-[40] rounded-none border-0 overflow-hidden" 
          : "h-[calc(100vh-80px)] overflow-hidden"
      )}>
        {isMobile ? (
          <div className="flex flex-1 overflow-hidden min-w-0 w-full">
            {!selectedConversation && (
              <div className="w-full h-full overflow-hidden flex flex-col">
                <div className="border-b bg-muted/30 flex-shrink-0 px-3 py-2 pt-14">
                  <Tabs value={activeTab} onValueChange={(v) => {
                    setActiveTab(v as 'chats' | 'groups');
                    selectedIdRef.current = null;
                    setSelectedConversation(null);
                    setMessages([]);
                  }}>
                    <TabsList className="grid grid-cols-2 w-[200px]">
                      <TabsTrigger value="chats" className="flex items-center gap-1.5 text-xs sm:text-sm">
                        <MessageSquare className="h-4 w-4" />
                        <span className="hidden xs:inline">Conversas</span>
                        <span className="xs:hidden">Chats</span>
                      </TabsTrigger>
                      <TabsTrigger value="groups" className="flex items-center gap-1.5 text-xs sm:text-sm">
                        <Users className="h-4 w-4" />
                        Grupos
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex-1 overflow-hidden">
                <ConversationList
                  conversations={conversations}
                  selectedId={selectedConversation?.id || null}
                  onSelect={handleMobileSelectConversation}
                  tags={tags}
                  team={team}
                  loading={loading}
                  onRefresh={loadConversations}
                  filters={filters}
  onFiltersChange={(newFilters) => setFilters(prev => ({ ...prev, ...newFilters }))}
  onLoadMore={() => loadConversations(true)}
  hasMore={hasMoreConversations}
  loadingMore={loadingMoreConversations}
                  isAdmin={isAdmin}
                  connections={connections}
                  onNewConversation={activeTab === 'chats' ? () => setNewConversationOpen(true) : undefined}
                  onAcceptConversation={handleAcceptConversation}
                  onReleaseConversation={async (id) => {
                    try { await releaseConversation(id); loadConversations(); toast.success('Conversa liberada'); } catch (error: any) { toast.error(error.message || 'Erro ao liberar conversa'); }
                  }}
                  onArchiveConversation={async (id) => {
                    try { await updateConversation(id, { is_archived: true }); loadConversations(); toast.success('Conversa arquivada'); } catch (error: any) { toast.error(error.message || 'Erro ao arquivar conversa'); }
                  }}
                  onFinishConversation={async (id) => { await handleFinishConversation(id); }}
                  onReopenConversation={async (id) => { await handleReopenConversation(id); }}
                  attendanceCounts={attendanceCounts}
                  onPinConversation={async (id, pinned) => {
                    try { await pinConversation(id, pinned); loadConversations(); toast.success(pinned ? 'Conversa fixada' : 'Conversa desafixada'); } catch (error: any) { toast.error(error.message || 'Erro ao fixar conversa'); }
                  }}
                  onFavoriteConversation={async (id, favorite) => {
                    try { await favoriteConversation(id, favorite); loadConversations(); toast.success(favorite ? 'Conversa favoritada' : 'Favorito removido'); } catch (error: any) { toast.error(error.message || 'Erro ao favoritar conversa'); }
                  }}
                  onMuteConversation={async (id, muted) => {
                    try { await muteConversation(id, muted); loadConversations(); toast.success(muted ? 'Notificações silenciadas' : 'Notificações reativadas'); } catch (error: any) { toast.error(error.message || 'Erro ao silenciar conversa'); }
                  }}
                  onGlobalSearchSelect={async (conversationId, messageId) => {
                    try {
                      const conv = await getConversation(conversationId);
                      if (conv) {
                        const convStatus = conv.attendance_status === 'waiting' ? 'waiting' : conv.attendance_status === 'finished' ? 'finished' : 'attending';
                        setFilters((prev) => ({ ...prev, attendance_status: convStatus }));
                        selectedIdRef.current = conv.id;
                        setSelectedConversation(conv);
                        const msgs = await getMessages(conversationId);
                        setMessages(msgs);
                      }
                    } catch (error: any) { toast.error('Erro ao abrir conversa'); }
                  }}
                />
                </div>
              </div>
            )}
            {selectedConversation && (
              <ChatArea
                conversation={selectedConversation} messages={messages} conversations={conversations} loading={loadingMessages} sending={sendingMessage}
                tags={tags} team={team} connections={connections} syncingHistory={syncingHistory} isAdmin={isAdmin} userRole={userRole}
                onSyncHistory={handleSyncHistory} onSendMessage={handleSendMessage} onForwardMessage={handleForwardMessage} onLoadMore={handleLoadMoreMessages} hasMore={hasMoreMessages}
                onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} onAssign={handleAssign} onArchive={handleArchive} onTransfer={handleTransfer} onCreateTag={handleCreateTag}
                onDeleteConversation={async () => { if (!selectedConversation) return; try { await deleteConversation(selectedConversation.id); toast.success('Conversa excluída'); setSelectedConversation(null); setMessages([]); loadConversations(); } catch (error: any) { toast.error(error.message || 'Erro ao excluir conversa'); } }}
                onReleaseConversation={handleReleaseConversation} onFinishConversation={() => handleFinishConversation()} onReopenConversation={() => handleReopenConversation()}
                onDepartmentChange={() => loadConversations()} isMobile={true} onMobileBack={handleMobileBack}
                onOpenCRM={() => setCrmPanelOpen(true)}
              />
            )}
            {selectedConversation && (
              <Sheet open={crmPanelOpen} onOpenChange={setCrmPanelOpen}>
                <SheetContent side="right" className="w-full max-w-sm p-0 [&>button]:hidden">
                  <SheetTitle className="sr-only">Painel CRM</SheetTitle>
                  <CRMSidePanel conversationId={selectedConversation.id}
                    contactPhone={selectedConversation.remote_jid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || null}
                    contactName={selectedConversation.contact_name || selectedConversation.group_name || null}
                    isOpen={true} onToggle={() => setCrmPanelOpen(false)}
                    chatMessages={messages.map(m => ({ id: m.id, content: m.content || '', sender: m.from_me ? 'me' : 'contact', timestamp: m.timestamp }))}
                  />
                </SheetContent>
              </Sheet>
            )}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden min-w-0 w-full">
            <ResizablePanel defaultSize={28} minSize={18} maxSize={45} className="overflow-hidden">
              <div className="h-full flex flex-col">
                <div className="border-b bg-muted/30 flex-shrink-0 px-4 py-2">
                  <Tabs value={activeTab} onValueChange={(v) => {
                    setActiveTab(v as 'chats' | 'groups');
                    selectedIdRef.current = null;
                    setSelectedConversation(null);
                    setMessages([]);
                  }}>
                    <TabsList className="grid grid-cols-2 w-[260px]">
                      <TabsTrigger value="chats" className="flex items-center gap-1.5 text-xs sm:text-sm">
                        <MessageSquare className="h-4 w-4" />
                        <span className="hidden xs:inline">Conversas</span>
                        <span className="xs:hidden">Chats</span>
                      </TabsTrigger>
                      <TabsTrigger value="groups" className="flex items-center gap-1.5 text-xs sm:text-sm">
                        <Users className="h-4 w-4" />
                        Grupos
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex-1 overflow-hidden">
                <ConversationList
                conversations={conversations}
                selectedId={selectedConversation?.id || null}
                onSelect={handleMobileSelectConversation}
                tags={tags}
                team={team}
                loading={loading}
                onRefresh={loadConversations}
                filters={filters}
  onFiltersChange={(newFilters) => setFilters(prev => ({ ...prev, ...newFilters }))}
  onLoadMore={() => loadConversations(true)}
  hasMore={hasMoreConversations}
  loadingMore={loadingMoreConversations}
                isAdmin={isAdmin}
                connections={connections}
                onNewConversation={activeTab === 'chats' ? () => setNewConversationOpen(true) : undefined}
                onAcceptConversation={handleAcceptConversation}
                onReleaseConversation={async (id) => {
                  try { await releaseConversation(id); loadConversations(); toast.success('Conversa liberada'); } catch (error: any) { toast.error(error.message || 'Erro ao liberar conversa'); }
                }}
                onArchiveConversation={async (id) => {
                  try { await updateConversation(id, { is_archived: true }); loadConversations(); toast.success('Conversa arquivada'); } catch (error: any) { toast.error(error.message || 'Erro ao arquivar conversa'); }
                }}
                onFinishConversation={async (id) => { await handleFinishConversation(id); }}
                onReopenConversation={async (id) => { await handleReopenConversation(id); }}
                attendanceCounts={attendanceCounts}
                onPinConversation={async (id, pinned) => {
                  try { await pinConversation(id, pinned); loadConversations(); toast.success(pinned ? 'Conversa fixada' : 'Conversa desafixada'); } catch (error: any) { toast.error(error.message || 'Erro ao fixar conversa'); }
                }}
                onFavoriteConversation={async (id, favorite) => {
                  try { await favoriteConversation(id, favorite); loadConversations(); toast.success(favorite ? 'Conversa favoritada' : 'Favorito removido'); } catch (error: any) { toast.error(error.message || 'Erro ao favoritar conversa'); }
                }}
                onMuteConversation={async (id, muted) => {
                  try { await muteConversation(id, muted); loadConversations(); toast.success(muted ? 'Notificações silenciadas' : 'Notificações reativadas'); } catch (error: any) { toast.error(error.message || 'Erro ao silenciar conversa'); }
                }}
                onGlobalSearchSelect={async (conversationId, messageId) => {
                  try {
                    const conv = await getConversation(conversationId);
                    if (conv) {
                      const convStatus = conv.attendance_status === 'waiting' ? 'waiting' : conv.attendance_status === 'finished' ? 'finished' : 'attending';
                      setFilters((prev) => ({ ...prev, attendance_status: convStatus }));
                      selectedIdRef.current = conv.id;
                      setSelectedConversation(conv);
                      const msgs = await getMessages(conversationId);
                      setMessages(msgs);
                    }
                  } catch (error: any) { toast.error('Erro ao abrir conversa'); }
                }}
              />
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={selectedConversation && modulesEnabled.crm && crmPanelOpen ? 47 : 72} minSize={30}>
              <ChatArea
                conversation={selectedConversation} messages={messages} conversations={conversations} loading={loadingMessages} sending={sendingMessage}
                tags={tags} team={team} connections={connections} syncingHistory={syncingHistory} isAdmin={isAdmin} userRole={userRole}
                onSyncHistory={handleSyncHistory} onSendMessage={handleSendMessage} onForwardMessage={handleForwardMessage} onLoadMore={handleLoadMoreMessages} hasMore={hasMoreMessages}
                onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} onAssign={handleAssign} onArchive={handleArchive} onTransfer={handleTransfer} onCreateTag={handleCreateTag}
                onDeleteConversation={async () => { if (!selectedConversation) return; try { await deleteConversation(selectedConversation.id); toast.success('Conversa excluída'); setSelectedConversation(null); setMessages([]); loadConversations(); } catch (error: any) { toast.error(error.message || 'Erro ao excluir conversa'); } }}
                onReleaseConversation={handleReleaseConversation} onFinishConversation={() => handleFinishConversation()} onReopenConversation={() => handleReopenConversation()}
                onDepartmentChange={() => loadConversations()} isMobile={false}
                onOpenCRM={() => setCrmPanelOpen(true)}
              />
            </ResizablePanel>

            {selectedConversation && crmPanelOpen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={25} minSize={18} maxSize={35} className="overflow-hidden">
                  <CRMSidePanel conversationId={selectedConversation.id}
                    contactPhone={selectedConversation.remote_jid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || null}
                    contactName={selectedConversation.contact_name || selectedConversation.group_name || null}
                    isOpen={true} onToggle={() => setCrmPanelOpen(false)}
                    chatMessages={messages.map(m => ({ id: m.id, content: m.content || '', sender: m.from_me ? 'me' : 'contact', timestamp: m.timestamp }))}
                  />
                </ResizablePanel>
              </>
            )}
            {selectedConversation && !crmPanelOpen && (
              <div className="relative shrink-0 w-6">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCrmPanelOpen(true)}
                  className="absolute top-1/2 -translate-y-1/2 z-20 h-12 w-6 rounded-l-md rounded-r-none border-r-0 bg-background shadow-md hover:bg-muted -left-0"
                  title="Abrir painel CRM"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            )}
          </ResizablePanelGroup>
        )}
      </div>

      {/* New Conversation Dialog */}
      <NewConversationDialog
        open={newConversationOpen}
        onOpenChange={setNewConversationOpen}
        connections={connections}
        onConversationCreated={handleNewConversationCreated}
      />
    </MainLayout>
  );
};

export default Chat;
