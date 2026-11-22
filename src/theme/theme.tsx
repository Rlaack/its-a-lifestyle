import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

type Theme = { c: Palette; isDark: boolean };
const ThemeContext = createContext<Theme>({ c: light, isDark: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const isDark = useColorScheme() === 'dark';
  return <ThemeContext.Provider value={{ c: isDark ? dark : light, isDark }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
