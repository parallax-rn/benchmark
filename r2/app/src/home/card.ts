import { StyleSheet } from 'react-native';

// One look for every small product card on Home, whichever strip draws it.
export const card = StyleSheet.create({
  strip: { paddingVertical: 8 },
  box: { width: 120, marginRight: 10, padding: 10, borderRadius: 8, backgroundColor: '#f2f2f2' },
  name: { fontSize: 14 },
  price: { fontSize: 14, fontWeight: '600', marginTop: 4 },
});
