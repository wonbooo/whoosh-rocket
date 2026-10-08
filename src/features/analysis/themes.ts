export interface BoardTheme {
  id: string;
  name: string;
  dark: boolean;
  background: string;
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  colors: string[];
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'default',
    name: '默认风格',
    dark: false,
    background: '#ffffff',
    panel: '#ffffff',
    panelAlt: '#f2f3f5',
    border: '#e5e6eb',
    text: '#1d2129',
    textMuted: 'rgba(29, 33, 41, 0.55)',
    accent: '#1783FF',
    accentText: '#ffffff',
    colors: [
      '#1783FF',
      '#00C9C9',
      '#F0884D',
      '#D580FF',
      '#7863FF',
      '#60C42D',
      '#BD8F24',
      '#FF80CA',
      '#2491B3',
      '#17C76F',
      '#AABA01',
      '#BC7CFC',
      '#237CBC',
      '#2DE379',
      '#CE8032',
      '#FF7AF4',
      '#545FD3',
      '#AFE410',
      '#D8C608',
      '#FFA1E0',
    ],
  },
  {
    id: 'dark',
    name: '暗色风格',
    dark: true,
    background: '#141414',
    panel: '#1f1f1f',
    panelAlt: '#2a2a2a',
    border: 'rgba(255, 255, 255, 0.16)',
    text: '#ffffff',
    textMuted: 'rgba(255, 255, 255, 0.55)',
    accent: '#1783FF',
    accentText: '#ffffff',
    colors: [
      '#1783FF',
      '#00C9C9',
      '#F0884D',
      '#D580FF',
      '#7863FF',
      '#60C42D',
      '#BD8F24',
      '#FF80CA',
      '#2491B3',
      '#17C76F',
      '#AABA01',
      '#BC7CFC',
      '#237CBC',
      '#2DE379',
      '#CE8032',
      '#FF7AF4',
      '#545FD3',
      '#AFE410',
      '#D8C608',
      '#FFA1E0',
    ],
  },
];

export const DEFAULT_THEME_ID = 'default';

export function findTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((theme) => theme.id === id) ?? BOARD_THEMES[0]!;
}
