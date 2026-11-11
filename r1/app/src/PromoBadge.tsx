import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const BADGE = 140;

// A corner ribbon over the product's picture.
export function PromoBadge({ label }: { label: string }) {
  return (
    <View testID="promo-badge" style={[styles.box, { height: BADGE }]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 12 },
  label: { backgroundColor: '#d1242f', color: 'white', fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
});
