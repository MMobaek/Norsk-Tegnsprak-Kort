import { create } from 'zustand';
import { getPref, setPref } from '../lib/prefs';

export type View = 'home' | 'review' | 'settings' | 'discarded';

interface AppState {
  view: View;
  dark: boolean;
  hc: boolean;
  newPerDay: number;
  setView: (v: View) => void;
  setDark: (b: boolean) => void;
  setHc: (b: boolean) => void;
  setNewPerDay: (n: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: 'home',
  dark: getPref('nts_dark', false),
  hc: getPref('nts_hc', false),
  newPerDay: getPref('nts_newPerDay', 20),
  setView: (view) => set({ view }),
  setDark: (dark) => {
    setPref('nts_dark', dark);
    set({ dark });
  },
  setHc: (hc) => {
    setPref('nts_hc', hc);
    set({ hc });
  },
  setNewPerDay: (newPerDay) => {
    setPref('nts_newPerDay', newPerDay);
    set({ newPerDay });
  }
}));

export function applyTheme(): void {
  const { dark, hc } = useAppStore.getState();
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('hc', hc);
}
