import { useState, useEffect, useCallback } from 'react';
import { API_URL, getAuthToken } from '@/lib/api';

const BRANDING_CACHE_KEY = 'app-branding-cache';
const BRANDING_CACHE_TTL_MS = 5 * 60 * 1000;
let brandingRequest: Promise<BrandingSettings | null> | null = null;

function getCachedBranding(): BrandingSettings | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(BRANDING_CACHE_KEY) || 'null');
    if (cached?.value && Date.now() - cached.savedAt < BRANDING_CACHE_TTL_MS) {
      return cached.value as BrandingSettings;
    }
  } catch { /* ignore invalid cache */ }
  return null;
}

function requestBranding(orgParam: string): Promise<BrandingSettings | null> {
  if (brandingRequest) return brandingRequest;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  brandingRequest = fetch(`${API_URL}/api/admin/branding${orgParam}`, { signal: controller.signal })
    .then(async (response) => response.ok ? response.json() as Promise<BrandingSettings> : null)
    .then((value) => {
      if (value) sessionStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify({ value, savedAt: Date.now() }));
      return value;
    })
    .catch(() => null)
    .finally(() => {
      window.clearTimeout(timeout);
      brandingRequest = null;
    });
  return brandingRequest;
}

export interface BrandingSettings {
  logo_login: string | null;
  logo_sidebar: string | null;
  logo_topbar: string | null;
  favicon: string | null;
  company_name: string | null;
  theme_preset: string | null;
  theme_custom_colors: string | null;
}

export interface ThemeModeColors {
  primary: string;
  secondary: string;
  accent: string;
  sidebar: string;
}

export interface ThemeColors {
  light: ThemeModeColors;
  dark: ThemeModeColors;
}

// Legacy flat format support
export interface ThemeColorsFlat {
  primary: string;
  secondary: string;
  accent: string;
  sidebar: string;
}

export function parseThemeColors(raw: string | null): ThemeColors | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // New format with light/dark
    if (parsed.light && parsed.dark) return parsed as ThemeColors;
    // Legacy flat format → apply to both
    if (parsed.primary) {
      const flat = parsed as ThemeColorsFlat;
      return {
        light: { ...flat },
        dark: {
          primary: flat.primary.replace(/(\d+)%\s*$/, (_, l) => `${Math.min(parseInt(l) + 5, 70)}%`),
          secondary: flat.secondary.replace(/(\d+)%\s*$/, (_, l) => `${Math.max(parseInt(l) - 74, 14)}%`),
          accent: flat.accent.replace(/(\d+)%\s*$/, (_, l) => `${Math.max(parseInt(l) - 72, 16)}%`),
          sidebar: flat.sidebar.replace(/(\d+)%\s*$/, (_, l) => `${Math.min(parseInt(l) + 5, 70)}%`),
        },
      };
    }
  } catch { /* ignore */ }
  return null;
}

function makeDarkVariant(light: ThemeModeColors): ThemeModeColors {
  const adjustForDark = (hsl: string, lightnessAdd: number) => {
    const parts = hsl.trim().split(/\s+/);
    const h = parts[0];
    const s = parts[1];
    const l = parseInt(parts[2]) || 50;
    return `${h} ${s} ${Math.min(Math.max(l + lightnessAdd, 10), 70)}%`;
  };
  return {
    primary: adjustForDark(light.primary, 3),
    secondary: light.secondary.replace(/(\d+)%\s*$/, (_, l) => `${Math.max(parseInt(l) - 76, 14)}%`),
    accent: light.accent.replace(/(\d+)%\s*$/, (_, l) => `${Math.max(parseInt(l) - 74, 16)}%`),
    sidebar: adjustForDark(light.sidebar, 3),
  };
}

export const THEME_PRESETS: Record<string, { name: string; colors: ThemeColors; preview: string[] }> = {
  default: {
    name: 'Gleego (Padrão)',
    colors: {
      light: { primary: '24 90% 52%', secondary: '217 60% 92%', accent: '152 50% 90%', sidebar: '24 90% 52%' },
      dark: { primary: '24 92% 55%', secondary: '217 40% 16%', accent: '152 40% 16%', sidebar: '24 92% 55%' },
    },
    preview: ['#e8600a', '#c2d6f2', '#c8f0dc'],
  },
  blue: {
    name: 'Azul Corporativo',
    colors: {
      light: { primary: '217 70% 50%', secondary: '217 60% 92%', accent: '200 60% 90%', sidebar: '217 70% 50%' },
      dark: { primary: '217 75% 58%', secondary: '217 40% 16%', accent: '200 40% 16%', sidebar: '217 75% 58%' },
    },
    preview: ['#2563eb', '#c2d6f2', '#c2e8f2'],
  },
  green: {
    name: 'Verde Profissional',
    colors: {
      light: { primary: '152 55% 40%', secondary: '152 40% 90%', accent: '170 50% 88%', sidebar: '152 55% 40%' },
      dark: { primary: '152 55% 45%', secondary: '152 30% 14%', accent: '170 35% 16%', sidebar: '152 55% 45%' },
    },
    preview: ['#1a9a5c', '#c8f0dc', '#c2f0e6'],
  },
  purple: {
    name: 'Roxo Moderno',
    colors: {
      light: { primary: '271 65% 55%', secondary: '271 40% 92%', accent: '300 50% 90%', sidebar: '271 65% 55%' },
      dark: { primary: '271 65% 60%', secondary: '271 30% 16%', accent: '300 35% 16%', sidebar: '271 65% 60%' },
    },
    preview: ['#8b5cf6', '#e2d6f2', '#f0c8f0'],
  },
  red: {
    name: 'Vermelho Dinâmico',
    colors: {
      light: { primary: '0 72% 50%', secondary: '0 40% 92%', accent: '20 60% 90%', sidebar: '0 72% 50%' },
      dark: { primary: '0 70% 55%', secondary: '0 30% 14%', accent: '20 40% 16%', sidebar: '0 70% 55%' },
    },
    preview: ['#dc2626', '#f2d6d6', '#f2e0c8'],
  },
  teal: {
    name: 'Teal Elegante',
    colors: {
      light: { primary: '180 55% 38%', secondary: '180 40% 90%', accent: '160 50% 88%', sidebar: '180 55% 38%' },
      dark: { primary: '180 55% 45%', secondary: '180 30% 14%', accent: '160 35% 16%', sidebar: '180 55% 45%' },
    },
    preview: ['#0d9488', '#c2f0f0', '#c2f0dc'],
  },
  pink: {
    name: 'Rosa Vibrante',
    colors: {
      light: { primary: '330 70% 55%', secondary: '330 40% 92%', accent: '350 50% 90%', sidebar: '330 70% 55%' },
      dark: { primary: '330 70% 60%', secondary: '330 30% 16%', accent: '350 35% 16%', sidebar: '330 70% 60%' },
    },
    preview: ['#ec4899', '#f2d6e6', '#f2d6d6'],
  },
  dark_blue: {
    name: 'Azul Marinho',
    colors: {
      light: { primary: '220 60% 40%', secondary: '220 40% 90%', accent: '200 50% 88%', sidebar: '220 60% 40%' },
      dark: { primary: '220 60% 50%', secondary: '220 30% 14%', accent: '200 35% 16%', sidebar: '220 60% 50%' },
    },
    preview: ['#2c4a7c', '#d0daf0', '#c8e4f0'],
  },
};

function applyModeColors(root: HTMLElement, colors: ThemeModeColors, selector: 'light' | 'dark') {
  // We need to set CSS custom properties scoped to :root (light) or .dark
  // Since we can only set on root element, we use a style tag approach
  const styleId = `theme-override-${selector}`;
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  const hue = colors.primary.split(' ')[0];
  const sidebarAccent = colors.sidebar.replace(/\d+%\s*$/, selector === 'light' ? '94%' : '15%');
  const sidebarAccentFg = colors.sidebar.replace(/\d+%\s*$/, selector === 'light' ? '35%' : '65%');
  const neonGlow = colors.primary.replace(/\d+%\s*$/, selector === 'light' ? '55%' : '58%');
  
  const selectorCss = selector === 'light' ? ':root, .light' : '.dark';
  
  styleEl.textContent = `
    ${selectorCss} {
      --primary: ${colors.primary};
      --ring: ${colors.primary};
      --sidebar-primary: ${colors.sidebar};
      --sidebar-ring: ${colors.sidebar};
      --sidebar-accent: ${sidebarAccent};
      --sidebar-accent-foreground: ${sidebarAccentFg};
      --message-sent: ${colors.primary};
      --neon-glow: ${neonGlow};
      --shadow-neon: 0 0 ${selector === 'light' ? '20px' : '30px'} hsl(${colors.primary} / ${selector === 'light' ? '0.3' : '0.4'});
      --gradient-primary: linear-gradient(135deg, hsl(${colors.primary}), hsl(${hue} 95% ${selector === 'light' ? '55%' : '58%'}));
    }
  `;
}

export function applyThemeColors(preset: string | null, customColors: string | null) {
  const root = document.documentElement;
  
  let themeColors: ThemeColors | null = null;
  
  if (preset === 'custom' && customColors) {
    themeColors = parseThemeColors(customColors);
  } else if (preset && THEME_PRESETS[preset]) {
    themeColors = THEME_PRESETS[preset].colors;
  }
  
  if (!themeColors) {
    // Remove overrides
    document.getElementById('theme-override-light')?.remove();
    document.getElementById('theme-override-dark')?.remove();
    return;
  }
  
  applyModeColors(root, themeColors.light, 'light');
  applyModeColors(root, themeColors.dark, 'dark');
}

export function useBranding() {
  const [branding, setBranding] = useState<BrandingSettings>(() => getCachedBranding() || ({
    logo_login: null,
    logo_sidebar: null,
    logo_topbar: null,
    favicon: null,
    company_name: null,
    theme_preset: null,
    theme_custom_colors: null,
  }));
  const [loading, setLoading] = useState(() => !getCachedBranding());

  const fetchBranding = useCallback(async () => {
    try {
      let orgParam = '';
      const cachedOrgId = sessionStorage.getItem('user_org_id');
      if (cachedOrgId) {
        orgParam = `?org_id=${cachedOrgId}`;
      }

      const data = getCachedBranding() || await requestBranding(orgParam);
      if (data) {
        setBranding(data);
        
        if (data.favicon) {
          const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (link) {
            link.href = data.favicon;
          }
        }
        
        applyThemeColors(data.theme_preset, data.theme_custom_colors);
      }
    } catch {
      // Keep cached/default branding when the backend is temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  return { branding, loading, refetch: fetchBranding };
}

export function useAdminSettings() {
  const [settings, setSettings] = useState<Array<{
    id: string;
    key: string;
    value: string | null;
    description: string | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_URL}/api/admin/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSetting = useCallback(async (key: string, value: string | null) => {
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_URL}/api/admin/settings/${key}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value }),
      });
      
      if (response.ok) {
        const updated = await response.json();
        setSettings(prev => 
          prev.map(s => s.key === key ? updated : s)
        );
        return updated;
      }
      throw new Error('Failed to update setting');
    } catch (error) {
      console.error('Error updating setting:', error);
      throw error;
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, updateSetting, refetch: fetchSettings };
}
