export type SolveLayout = 'classic' | 'document';
export type BgStyle = 'plain' | 'grid';

export interface AppSettings {
  solveLayout: SolveLayout;
  palmRejection: boolean;
  defaultBgStyle: BgStyle;
}

const DEFAULTS: AppSettings = {
  solveLayout: 'classic',
  palmRejection: true,
  defaultBgStyle: 'plain',
};

const KEY = 'cozhocam_settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
