import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type Flags = { newCheckout: boolean };
const DEFAULTS: Flags = { newCheckout: true };
// Version 2 of the stored flags; version 1 lived under 'flags' and is ignored.
const KEY = 'flags:v2';

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(DEFAULTS);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) setFlags({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Flags>) });
    });
  }, []);
  return flags;
}
