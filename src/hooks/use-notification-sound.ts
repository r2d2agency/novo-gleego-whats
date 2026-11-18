import { useState, useEffect, useCallback } from 'react';

// Notification sound options - including nostalgic retro sounds
export const NOTIFICATION_SOUNDS = [
  { id: 'default', name: 'Padrão', file: '/sounds/notification-default.mp3' },
  { id: 'chime', name: 'Sino', file: '/sounds/notification-chime.mp3' },
  { id: 'pop', name: 'Pop', file: '/sounds/notification-pop.mp3' },
  { id: 'ding', name: 'Ding', file: '/sounds/notification-ding.mp3' },
  { id: 'message', name: 'Mensagem', file: '/sounds/notification-message.mp3' },
  { id: 'laser', name: 'Laser', file: '/sounds/notification-laser.mp3' },
  // Nostalgic retro sounds
  { id: 'classic', name: 'Clássico (ICQ style)', file: '/sounds/notification-classic.mp3' },
  { id: 'retro', name: 'Retrô (MSN style)', file: '/sounds/notification-retro.mp3' },
  { id: 'bubble', name: 'Bolha', file: '/sounds/notification-bubble.mp3' },
  { id: 'beep', name: 'Bip Nostálgico', file: '/sounds/notification-beep.mp3' },
  { id: 'none', name: 'Sem som', file: null },
] as const;

// Sound options specifically for new conversations in waiting queue
export const NEW_CONVERSATION_SOUNDS = [
  { id: 'chime', name: 'Sino (duplo)', file: '/sounds/notification-chime.mp3' },
  { id: 'classic', name: 'Clássico (ICQ style)', file: '/sounds/notification-classic.mp3' },
  { id: 'retro', name: 'Retrô (MSN style)', file: '/sounds/notification-retro.mp3' },
  { id: 'laser', name: 'Laser', file: '/sounds/notification-laser.mp3' },
  { id: 'ding', name: 'Ding', file: '/sounds/notification-ding.mp3' },
  { id: 'default', name: 'Padrão', file: '/sounds/notification-default.mp3' },
  { id: 'none', name: 'Sem som', file: null },
] as const;

export type NotificationSoundId = typeof NOTIFICATION_SOUNDS[number]['id'];
export type NewConversationSoundId = typeof NEW_CONVERSATION_SOUNDS[number]['id'];

interface NotificationSoundSettings {
  soundEnabled: boolean;
  soundEnabledMobile: boolean;
  soundEnabledDesktop: boolean;
  soundId: NotificationSoundId;
  newConversationSoundId: NewConversationSoundId;
  pushEnabled: boolean;
  volume: number;
  mutedConnections: string[]; // connection IDs that are muted
  mutedConversations: string[]; // conversation IDs that are muted
  muteGroups: boolean; // when true, mute all WhatsApp groups by default
  allowedGroups: string[]; // conversation IDs of groups allowed when muteGroups is true
}

const SETTINGS_KEY = 'notification-sound-settings';
const SETTINGS_DB_NAME = 'gleego-notification-settings';
const SETTINGS_STORE_NAME = 'settings';

const defaultSettings: NotificationSoundSettings = {
  soundEnabled: true,
  soundEnabledMobile: true,
  soundEnabledDesktop: true,
  soundId: 'default',
  newConversationSoundId: 'chime',
  pushEnabled: false,
  volume: 0.7,
  mutedConnections: [],
  mutedConversations: [],
  muteGroups: false,
  allowedGroups: [],
};

function syncNotificationSettingsForServiceWorker(settings: NotificationSoundSettings) {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;

  try {
    const request = indexedDB.open(SETTINGS_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        tx.objectStore(SETTINGS_STORE_NAME).put(settings, SETTINGS_KEY);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch {
        db.close();
      }
    };
  } catch {
    // IndexedDB may be unavailable in private mode; localStorage still works for in-app sounds.
  }
}

// Detect if current device is mobile
function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
}

// Audio cache to avoid re-loading
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudio(soundId: NotificationSoundId): HTMLAudioElement | null {
  const sound = NOTIFICATION_SOUNDS.find(s => s.id === soundId);
  if (!sound?.file) return null;

  if (!audioCache[soundId]) {
    audioCache[soundId] = new Audio(sound.file);
  }
  return audioCache[soundId];
}

export function useNotificationSound() {
  const [settings, setSettingsState] = useState<NotificationSoundSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');

  // Keep a copy of the local notification preferences in IndexedDB so the
  // service worker can also suppress push sound/vibration for muted groups
  // when the app is in the background or closed.
  useEffect(() => {
    syncNotificationSettingsForServiceWorker(settings);
  }, [settings]);

  // Check push permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  const updateSettings = useCallback((updates: Partial<NotificationSoundSettings>) => {
    setSettingsState(prev => {
      const newSettings = { ...prev, ...updates };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      syncNotificationSettingsForServiceWorker(newSettings);
      // Notify other hook instances in the same tab
      window.dispatchEvent(new CustomEvent('notification-settings-changed', { detail: newSettings }));
      return newSettings;
    });
  }, []);

  // Sync state when another hook instance updates settings
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setSettingsState(detail);
    };
    window.addEventListener('notification-settings-changed', handler);
    return () => window.removeEventListener('notification-settings-changed', handler);
  }, []);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      
      if (permission === 'granted') {
        updateSettings({ pushEnabled: true });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }, [updateSettings]);

  const isSoundAllowedForDevice = useCallback(() => {
    if (!settings.soundEnabled) return false;
    const mobile = isMobileDevice();
    if (mobile && !settings.soundEnabledMobile) return false;
    if (!mobile && !settings.soundEnabledDesktop) return false;
    return true;
  }, [settings.soundEnabled, settings.soundEnabledMobile, settings.soundEnabledDesktop]);

  const isConnectionMuted = useCallback((connectionId?: string) => {
    if (!connectionId) return false;
    return settings.mutedConnections.includes(connectionId);
  }, [settings.mutedConnections]);

  const isConversationMuted = useCallback((conversationId?: string) => {
    if (!conversationId) return false;
    return (settings.mutedConversations || []).includes(conversationId);
  }, [settings.mutedConversations]);

  // Returns true when the conversation should be silenced.
  // When `muteGroups` is on, groups are silenced UNLESS they are in `allowedGroups`
  // (per-group allow-list). When `muteGroups` is off, only groups in
  // `mutedConversations` are silenced.
  const isGroupMuted = useCallback((isGroup?: boolean, conversationId?: string) => {
    if (!isGroup) return false;
    if (settings.muteGroups) {
      if (conversationId && (settings.allowedGroups || []).includes(conversationId)) return false;
      return true;
    }
    return isConversationMuted(conversationId);
  }, [settings.muteGroups, settings.allowedGroups, isConversationMuted]);

  const toggleGroupAllowed = useCallback((conversationId: string) => {
    const allowed = settings.allowedGroups || [];
    const next = allowed.includes(conversationId)
      ? allowed.filter(id => id !== conversationId)
      : [...allowed, conversationId];
    updateSettings({ allowedGroups: next });
  }, [settings.allowedGroups, updateSettings]);

  const toggleConversationMute = useCallback((conversationId: string) => {
    const muted = settings.mutedConversations || [];
    const newMuted = muted.includes(conversationId)
      ? muted.filter(id => id !== conversationId)
      : [...muted, conversationId];
    updateSettings({ mutedConversations: newMuted });
  }, [settings.mutedConversations, updateSettings]);

  const playSound = useCallback((customSoundId?: NotificationSoundId) => {
    if (!isSoundAllowedForDevice()) return;
    
    const soundId = customSoundId || settings.soundId;
    const audio = getAudio(soundId);
    
    if (audio) {
      audio.volume = settings.volume;
      audio.currentTime = 0;
      audio.play().catch(err => {
        console.warn('Could not play notification sound:', err);
      });
    }
  }, [isSoundAllowedForDevice, settings.soundId, settings.volume]);

  // Play special sound for new conversations entering the waiting queue (plays twice for emphasis)
  const playNewConversationSound = useCallback(() => {
    if (!isSoundAllowedForDevice()) return;
    
    const soundId = settings.newConversationSoundId || 'chime';
    if (soundId === 'none') return;
    
    const sound = NEW_CONVERSATION_SOUNDS.find(s => s.id === soundId);
    if (!sound?.file) return;
    
    const audio = new Audio(sound.file);
    audio.volume = settings.volume;
    
    audio.play().then(() => {
      setTimeout(() => {
        const audio2 = new Audio(sound.file!);
        audio2.volume = settings.volume;
        audio2.play().catch(() => {});
      }, 300);
    }).catch(err => {
      console.warn('Could not play new conversation sound:', err);
    });
  }, [isSoundAllowedForDevice, settings.newConversationSoundId, settings.volume]);

  const previewSound = useCallback((soundId: NotificationSoundId) => {
    const audio = getAudio(soundId);
    if (audio) {
      audio.volume = settings.volume;
      audio.currentTime = 0;
      audio.play().catch(err => {
        console.warn('Could not play sound preview:', err);
      });
    }
  }, [settings.volume]);

  const showPushNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (!settings.pushEnabled || pushPermission !== 'granted') return;
    
    try {
      const notificationData = options?.data as { url?: string } | undefined;
      const notification = new Notification(title, {
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        tag: `local-${Date.now()}`,
        ...options,
      });

      notification.onclick = () => {
        window.focus();
        if (notificationData?.url) {
          window.location.assign(notificationData.url);
        }
        notification.close();
      };

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } catch (error) {
      console.error('Error showing push notification:', error);
    }
  }, [settings.pushEnabled, pushPermission]);

  const notify = useCallback((title: string, body?: string, options?: { playSound?: boolean }) => {
    // Play sound
    if (options?.playSound !== false) {
      playSound();
    }

    // Show push notification
    if (settings.pushEnabled && pushPermission === 'granted') {
      showPushNotification(title, { body });
    }
  }, [playSound, showPushNotification, settings.pushEnabled, pushPermission]);

  return {
    settings,
    updateSettings,
    pushPermission,
    requestPushPermission,
    playSound,
    playNewConversationSound,
    previewSound,
    showPushNotification,
    notify,
    isConnectionMuted,
    isConversationMuted,
    isGroupMuted,
    toggleConversationMute,
    toggleGroupAllowed,
    isMobileDevice: isMobileDevice(),
    isPushSupported: typeof window !== 'undefined' && 'Notification' in window,
  };
}
