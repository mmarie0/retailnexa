/** Themes (#116), from the owner's RetailNexa app: 4 light, 4 dark. Swatches: paper, card, accent, ink. */
export const THEMES = [
  { id: 'sky', name: 'Sky', mode: 'light', sw: ['#ddeffc', '#ffffff', '#5b7ff5', '#1f2a4d'] },
  { id: 'white', name: 'Clean white', mode: 'light', sw: ['#f3f4f7', '#ffffff', '#3e63dd', '#1b1f2a'] },
  { id: 'sand', name: 'Sand', mode: 'light', sw: ['#f4ede2', '#fffdf9', '#c2643a', '#3a2e22'] },
  { id: 'mint', name: 'Mint', mode: 'light', sw: ['#dff3ec', '#ffffff', '#14946f', '#16372e'] },
  { id: 'midnight', name: 'Midnight blue', mode: 'dark', sw: ['#0f1630', '#18213f', '#7c9bff', '#e6ebfa'] },
  { id: 'charcoal', name: 'Charcoal', mode: 'dark', sw: ['#17181b', '#222327', '#8aa4ff', '#ececee'] },
  { id: 'oled', name: 'True black', mode: 'dark', sw: ['#000000', '#0e0e10', '#8fa8ff', '#f2f2f4'] },
  { id: 'plum', name: 'Plum', mode: 'dark', sw: ['#1c1328', '#271b37', '#c38bff', '#f0e8fa'] },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const THEME_COOKIE = 'rn_theme';
/** A saved theme, or Sky for anything unknown. */
export const themeFrom = (v: string | undefined | null): ThemeId => (THEMES.find((t) => t.id === v)?.id ?? 'sky');
