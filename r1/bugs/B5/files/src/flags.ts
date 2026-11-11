import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type Flags = { newCheckout: boolean };
const DEFAULTS: Flags = { newCheckout: true };
const KEY = 'flags';

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(DEFAULTS);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) setFlags({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Flags>) });
    });
  }, []);
  return flags;
}
