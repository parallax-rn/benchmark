import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { Product } from '../api';
import { formatPrice } from '../price';

export function ProductRow({ item, stock, onPress }: { item: Product; stock?: number; onPress: () => void }) {
  return (
    <Pressable testID={`row/${item.id}`} onPress={onPress} style={styles.row}>
      <Text style={styles.name}>{item.name}</Text>
      {stock !== undefined ? <Text testID={`row/${item.id}/stock`}>{stock > 0 ? 'In stock' : 'Out of stock'}</Text> : null}
      <Text testID={`row/${item.id}/price`}>{formatPrice(item.price)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  name: { fontSize: 16 },
});
