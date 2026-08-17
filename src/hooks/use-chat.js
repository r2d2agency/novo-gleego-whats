import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
export const useChat = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const alertsPollingRef = useRef(null);
    const lastAlertIdRef = useRef(null);
    // Alerts polling - show toast when new scheduled messages are sent
    const getAlerts = useCallback(async () => {
        try {
            const data = await api('/api/chat/alerts');
            return data;
        }
        catch (err) {
            console.error('Error fetching alerts:', err);
            return [];
        }
    }, []);
    const markAlertsRead = useCallback(async (alertIds) => {
        try {
            await api('/api/chat/alerts/read', {
                method: 'POST',
                body: { alert_ids: alertIds },
            });
        }
        catch (err) {
            console.error('Error marking alerts as read:', err);
        }
    }, []);
    // Start polling for alerts
    const startAlertsPolling = useCallback(() => {
        if (alertsPollingRef.current)
            return;
        const pollAlerts = async () => {
            const alerts = await getAlerts();
            if (alerts.length > 0) {
                // Show toast for new alerts
                const newAlerts = lastAlertIdRef.current
                    ? alerts.filter(a => a.id !== lastAlertIdRef.current && new Date(a.created_at) > new Date(Date.now() - 60000))
                    : alerts.filter(a => new Date(a.created_at) > new Date(Date.now() - 10000));
                newAlerts.forEach(alert => {
                    toast.success(alert.title, {
                        description: alert.message || undefined,
                        duration: 5000,
                    });
                });
                if (newAlerts.length > 0) {
                    // Mark as read
                    await markAlertsRead(newAlerts.map(a => a.id));
                }
                lastAlertIdRef.current = alerts[0]?.id || null;
            }
        };
        // Initial poll
        pollAlerts();
        // Poll every 15 seconds
        alertsPollingRef.current = setInterval(pollAlerts, 15000);
    }, [getAlerts, markAlertsRead]);
    const stopAlertsPolling = useCallback(() => {
        if (alertsPollingRef.current) {
            clearInterval(alertsPollingRef.current);
            alertsPollingRef.current = null;
        }
    }, []);
    // Conversations
    const getConversations = useCallback(async (filters) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (filters?.search)
                params.append('search', filters.search);
            if (filters?.tag && filters.tag !== 'all')
                params.append('tag', filters.tag);
            if (filters?.assigned && filters.assigned !== 'all')
                params.append('assigned', filters.assigned);
            if (filters?.archived !== undefined)
                params.append('archived', String(filters.archived));
            if (filters?.connections && Array.isArray(filters.connections) && filters.connections.length > 0) {
                filters.connections.forEach(c => params.append('connection_ids[]', c));
            }
            else if (filters?.connection && filters.connection !== 'all') {
                params.append('connection', filters.connection);
                params.append('connection_id', filters.connection);
            }
            if (filters?.is_group !== undefined)
                params.append('is_group', String(filters.is_group));
            if (filters?.attendance_status)
                params.append('attendance_status', filters.attendance_status);
            if (filters?.department && filters.department !== 'all')
                params.append('department', filters.department);
            if (filters?.favorite === 'true')
                params.append('favorite', 'true');
            if (filters?.startDate)
                params.append('startDate', filters.startDate);
            if (filters?.endDate)
                params.append('endDate', filters.endDate);
            if (filters?.limit)
                params.append('limit', String(filters.limit));
            if (filters?.offset)
                params.append('offset', String(filters.offset));
            // If restricted and "all" connections is selected, we must ensure we only get allowed ones.
            // However, the backend should ideally handle this. If it doesn't, we might need to 
            // fetch each allowed connection separately or filter here.
            // For now, we'll assume the backend might need the list of allowed connections if we're not admin.
            const url = `/api/chat/conversations${params.toString() ? `?${params}` : ''}`;
            let data = await api(url);
            // Client-side filter fallback for connection and tag if backend doesn't support it
            if (filters?.connections && filters.connections.length > 0) {
                data = data.filter(conv => filters.connections.includes(conv.connection_id));
            }
            else if (filters?.connection && filters.connection !== 'all') {
                data = data.filter(conv => conv.connection_id === filters.connection);
            }
            if (filters?.tag && filters.tag !== 'all') {
                data = data.filter(conv => conv.tags?.some(t => t.id === filters.tag));
            }
            if (filters?.is_group !== undefined) {
                const isGroupBool = String(filters.is_group) === 'true';
                data = data.filter(conv => !!conv.is_group === isGroupBool);
            }
            // Frontend fallback filtering for "Hybrid Mode" and security
            if (user?.role !== 'owner' && user?.role !== 'admin' && user?.organization_id) {
                try {
                    const allowedConnections = await getConnections();
                    const allowedIds = new Set(allowedConnections.map(c => c.id));
                    return data.filter(conv => allowedIds.has(conv.connection_id));
                }
                catch {
                    return data;
                }
            }
            return data;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Erro ao buscar conversas';
            setError(message);
            throw err;
        }
        finally {
            setLoading(false);
        }
    }, []);
    const getConnections = useCallback(async () => {
        try {
            const allConnections = await api('/api/connections');
            // If user is owner or admin, they see everything
            if (user?.role === 'owner' || user?.role === 'admin') {
                return allConnections;
            }
            // Check if there are access groups defined for this organization
            if (user?.organization_id) {
                try {
                    const accessGroups = await api(`/api/organizations/${user.organization_id}/access-groups`);
                    // If there ARE access groups, strictly filter by those groups the user belongs to
                    if (accessGroups && accessGroups.length > 0) {
                        const userGroups = accessGroups.filter(group => group.user_ids && group.user_ids.includes(user.id));
                        const allowedConnectionIds = new Set();
                        userGroups.forEach(group => {
                            if (group.connection_ids) {
                                group.connection_ids.forEach(id => allowedConnectionIds.add(id));
                            }
                        });
                        return allConnections.filter(conn => allowedConnectionIds.has(conn.id));
                    }
                    // If NO access groups are created, check for direct connection assignments (Hybrid Mode)
                    try {
                        const memberInfo = await api(`/api/organizations/${user.organization_id}/members/${user.id}`);
                        if (memberInfo && memberInfo.assigned_connections && memberInfo.assigned_connections.length > 0) {
                            const assignedIds = new Set(memberInfo.assigned_connections.map((c) => c.id));
                            return allConnections.filter(conn => assignedIds.has(conn.id));
                        }
                    }
                    catch (e) {
                        // Fallback
                    }
                }
                catch (error) {
                    console.error('[useChat] Error fetching access groups:', error);
                    return allConnections;
                }
            }
            return allConnections;
        }
        catch (err) {
            console.error('Error fetching connections:', err);
            return [];
        }
    }, [user]);
    // Get chat statistics
    const getChatStats = useCallback(async () => {
        const data = await api('/api/chat/stats');
        return data;
    }, []);
    // Pin/unpin conversation
    const pinConversation = useCallback(async (id, pinned) => {
        await api(`/api/chat/conversations/${id}/pin`, {
            method: 'POST',
            body: { pinned },
        });
    }, []);
    // Favorite/unfavorite conversation
    const favoriteConversation = useCallback(async (id, favorite) => {
        await api(`/api/chat/conversations/${id}/favorite`, {
            method: 'POST',
            body: { favorite },
        });
    }, []);
    // Mute/unmute conversation (silences push notifications)
    const muteConversation = useCallback(async (id, muted) => {
        await api(`/api/chat/conversations/${id}/mute`, {
            method: 'POST',
            body: { muted },
        });
    }, []);
    // Accept conversation (move to attending)
    const acceptConversation = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}/accept`, { method: 'POST' });
    }, []);
    // Release conversation (move back to waiting)
    const releaseConversation = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}/release`, { method: 'POST' });
    }, []);
    // Finish conversation (mark as completed)
    const finishConversation = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}/finish`, { method: 'POST' });
    }, []);
    // Reopen conversation (move back to waiting for new flow)
    const reopenConversation = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}/reopen`, { method: 'POST' });
    }, []);
    const getConversation = useCallback(async (id) => {
        const data = await api(`/api/chat/conversations/${id}`);
        return data;
    }, []);
    const updateConversation = useCallback(async (id, updates) => {
        const data = await api(`/api/chat/conversations/${id}`, {
            method: 'PATCH',
            body: updates,
        });
        return data;
    }, []);
    const markAsRead = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}/read`, { method: 'POST' });
    }, []);
    const deleteConversation = useCallback(async (id) => {
        await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    }, []);
    const transferConversation = useCallback(async (id, toUserId, note) => {
        await api(`/api/chat/conversations/${id}/transfer`, {
            method: 'POST',
            body: { to_user_id: toUserId, note },
        });
    }, []);
    // Messages
    const getMessages = useCallback(async (conversationId, options) => {
        const params = new URLSearchParams();
        if (options?.limit)
            params.append('limit', String(options.limit));
        if (options?.before)
            params.append('before', options.before);
        if (options?.days)
            params.append('days', String(options.days));
        const url = `/api/chat/conversations/${conversationId}/messages${params.toString() ? `?${params}` : ''}`;
        const data = await api(url);
        return data;
    }, []);
    const sendMessage = useCallback(async (conversationId, message) => {
        const data = await api(`/api/chat/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: message,
            // Envio de mídia grande (PDF/vídeo) agora aguarda o aceite real do provider.
            // PDFs de 60MB+ podem demorar alguns minutos para o provider baixar e encaminhar.
            timeoutMs: 300000,
        });
        return data;
    }, []);
    const retryMediaDownload = useCallback(async (messageId) => {
        try {
            const data = await api(`/api/chat/messages/${messageId}/retry-download`, { method: 'POST' });
            return data;
        }
        catch (err) {
            console.error('Error retrying media download:', err);
            throw err;
        }
    }, []);
    // Tags
    const getTags = useCallback(async () => {
        const data = await api('/api/chat/tags');
        return data;
    }, []);
    const createTag = useCallback(async (name, color) => {
        const data = await api('/api/chat/tags', {
            method: 'POST',
            body: { name, color },
        });
        return data;
    }, []);
    const deleteTag = useCallback(async (id) => {
        await api(`/api/chat/tags/${id}`, { method: 'DELETE' });
    }, []);
    const addTagToConversation = useCallback(async (conversationId, tagId) => {
        await api(`/api/chat/conversations/${conversationId}/tags`, {
            method: 'POST',
            body: { tag_id: tagId },
        });
    }, []);
    const removeTagFromConversation = useCallback(async (conversationId, tagId) => {
        await api(`/api/chat/conversations/${conversationId}/tags/${tagId}`, {
            method: 'DELETE',
        });
    }, []);
    // Team
    const getTeam = useCallback(async () => {
        const data = await api('/api/chat/team');
        return data;
    }, []);
    // History sync (provider-aware)
    const syncChatHistory = useCallback(async (params) => {
        let url = `/api/evolution/${params.connectionId}/sync-chat`;
        let body = {
            remoteJid: params.remoteJid,
            days: params.days ?? 30,
        };
        if (params.provider === 'uazapi') {
            url = `/api/uazapi/${params.connectionId}/sync-messages`;
            body = {
                chatId: params.remoteJid,
                limit: (params.days ?? 30) * 500, // Aumentado para garantir histórico longo (30 dias padrão)
                days: params.days ?? 30, // Enviando também o parâmetro days caso o backend suporte
            };
        }
        else if (params.provider === 'wapi') {
            // W-API uses a different sync flow, but we can call sync-conversations for the whole instance
            // or just return a message saying it's not supported per-chat yet
            url = `/api/wapi/${params.connectionId}/sync-conversations`;
            body = {};
        }
        const data = await api(url, {
            method: 'POST',
            body,
        });
        return data;
    }, []);
    // Notes
    const getNotes = useCallback(async (conversationId) => {
        try {
            const data = await api(`/api/chat/conversations/${conversationId}/notes`);
            return data;
        }
        catch (err) {
            console.error('Erro ao buscar anotações:', err);
            return [];
        }
    }, []);
    const createNote = useCallback(async (conversationId, content) => {
        try {
            const data = await api(`/api/chat/conversations/${conversationId}/notes`, {
                method: 'POST',
                body: { content },
            });
            return data;
        }
        catch (err) {
            setError(err.message || 'Erro ao criar anotação');
            return null;
        }
    }, []);
    const updateNote = useCallback(async (conversationId, noteId, content) => {
        try {
            const data = await api(`/api/chat/conversations/${conversationId}/notes/${noteId}`, {
                method: 'PATCH',
                body: { content },
            });
            return data;
        }
        catch (err) {
            setError(err.message || 'Erro ao atualizar anotação');
            return null;
        }
    }, []);
    const deleteNote = useCallback(async (conversationId, noteId) => {
        try {
            await api(`/api/chat/conversations/${conversationId}/notes/${noteId}`, {
                method: 'DELETE',
            });
            return true;
        }
        catch (err) {
            setError(err.message || 'Erro ao excluir anotação');
            return false;
        }
    }, []);
    // Typing status
    const getTypingStatus = useCallback(async (conversationId) => {
        if (!conversationId)
            return false;
        try {
            const response = await api(`/api/evolution/typing/${conversationId}`);
            return response.isTyping || false;
        }
        catch (err) {
            // Silently handle 404 errors (conversation doesn't exist yet)
            if (!err.message?.includes('não encontrada')) {
                console.error('Error getting typing status:', err);
            }
            return false;
        }
    }, []);
    // Scheduled Messages
    const getScheduledMessages = useCallback(async (conversationId) => {
        const data = await api(`/api/chat/conversations/${conversationId}/scheduled`);
        return data;
    }, []);
    const scheduleMessage = useCallback(async (conversationId, message) => {
        const data = await api(`/api/chat/conversations/${conversationId}/schedule`, {
            method: 'POST',
            body: message,
        });
        return data;
    }, []);
    const cancelScheduledMessage = useCallback(async (messageId) => {
        await api(`/api/chat/scheduled/${messageId}`, { method: 'DELETE' });
    }, []);
    const getScheduledCount = useCallback(async () => {
        const data = await api(`/api/chat/scheduled/count`);
        return data.count;
    }, []);
    // Sync group name from W-API
    const syncGroupName = useCallback(async (connectionId, conversationId) => {
        try {
            const data = await api(`/api/wapi/${connectionId}/sync-group-name/${conversationId}`, {
                method: 'POST',
            });
            return data;
        }
        catch (err) {
            console.error('Error syncing group name:', err);
            return { success: false };
        }
    }, []);
    // Sync all group names from W-API for a connection
    const syncAllGroupNames = useCallback(async (connectionId) => {
        try {
            const data = await api(`/api/wapi/${connectionId}/sync-all-groups`, {
                method: 'POST',
            });
            return data;
        }
        catch (err) {
            console.error('Error syncing all group names:', err);
            return { success: false };
        }
    }, []);
    // Get attendance counts for tabs
    const getAttendanceCounts = useCallback(async (isGroup) => {
        try {
            const data = await api(`/api/chat/conversations/attendance-counts?is_group=${isGroup}`);
            return data;
        }
        catch (err) {
            console.error('Error fetching attendance counts:', err);
            return { waiting: 0, attending: 0, finished: 0 };
        }
    }, []);
    // Log voice call
    const logCall = useCallback(async (conversationId, callData) => {
        try {
            const data = await api(`/api/chat/conversations/${conversationId}/call-log`, {
                method: 'POST',
                body: callData,
            });
            return data;
        }
        catch (err) {
            setError(err.message || 'Erro ao registrar chamada');
            return null;
        }
    }, []);
    // Pin/Unpin message
    const pinMessage = useCallback(async (conversationId, messageId) => {
        try {
            await api(`/api/chat/conversations/${conversationId}/pin-message`, {
                method: 'POST',
                body: { message_id: messageId },
            });
            return true;
        }
        catch (err) {
            console.error('Erro ao fixar mensagem:', err);
            return false;
        }
    }, []);
    // Edit message
    const editMessage = useCallback(async (conversationId, messageId, content) => {
        try {
            await api(`/api/chat/conversations/${conversationId}/messages/${messageId}`, {
                method: 'PATCH',
                body: { content },
            });
            return true;
        }
        catch (err) {
            console.error('Erro ao editar mensagem:', err);
            return false;
        }
    }, []);
    // Delete message
    const deleteMessageFn = useCallback(async (conversationId, messageId) => {
        try {
            await api(`/api/chat/conversations/${conversationId}/messages/${messageId}`, {
                method: 'DELETE',
            });
            return true;
        }
        catch (err) {
            console.error('Erro ao apagar mensagem:', err);
            return false;
        }
    }, []);
    const cancelActiveFlow = useCallback(async (conversationId) => {
        try {
            await api(`/api/flows/conversation/${conversationId}/cancel`, { method: 'POST' });
            return true;
        }
        catch (err) {
            console.error('Erro ao cancelar fluxo:', err);
            return false;
        }
    }, []);
    return {
        loading,
        error,
        // Conversations
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
        cancelActiveFlow,
        // Connections
        getConnections,
        // Stats
        getChatStats,
        // Messages
        getMessages,
        sendMessage,
        retryMediaDownload,
        editMessage,
        deleteMessage: deleteMessageFn,
        pinMessage,
        // Tags
        getTags,
        createTag,
        deleteTag,
        addTagToConversation,
        removeTagFromConversation,
        // Team
        getTeam,
        // History sync
        syncChatHistory,
        // Notes
        getNotes,
        createNote,
        updateNote,
        deleteNote,
        // Typing
        getTypingStatus,
        // Scheduled Messages
        getScheduledMessages,
        scheduleMessage,
        cancelScheduledMessage,
        getScheduledCount,
        // Groups
        syncGroupName,
        syncAllGroupNames,
        // Alerts
        getAlerts,
        markAlertsRead,
        startAlertsPolling,
        stopAlertsPolling,
        // Attendance counts
        getAttendanceCounts,
        // Call logs
        logCall,
    };
};
