import type { ThemePreference } from '@shared/types';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemePreference, string> = {
  system: '🖥 System',
  light: '☀ Light',
  dark: '🌙 Dark',
};

/** Resolve and apply the effective theme to the <html> element. */
export function applyTheme(pref: ThemePreference): void {
  const effective =
    pref === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : pref;
  document.documentElement.setAttribute('data-theme', effective);
}

export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  const next = () => {
    const idx = ORDER.indexOf(value);
    onChange(ORDER[(idx + 1) % ORDER.length] ?? 'system');
  };
  return (
    <button className="btn ghost" onClick={next} title="Toggle theme (dark / light / system)">
      {LABEL[value]}
    </button>
  );
}
