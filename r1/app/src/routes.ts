import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type Routes = {
  Home: undefined;
  Products: undefined;
  Product: { id: string };
  Search: undefined;
  Cart: undefined;
  Settings: undefined;
};

export type ScreenProps<K extends keyof Routes> = NativeStackScreenProps<Routes, K>;
