import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { cartTotal, useCart } from '../cart';
import { useFlags } from '../flags';
import { formatPrice } from '../price';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Cart(_: ScreenProps<'Cart'>) {
  const items = useCart(s => s.items);
  const clear = useCart(s => s.clear);
  const flags = useFlags();
  return (
    <View style={styles.page}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        ListEmptyComponent={<Text>Your cart is empty</Text>}
        renderItem={({ item }) => <Text style={styles.row}>{`${item.name} x${item.qty}  ${formatPrice(item.price)}`}</Text>}
      />
      <Text testID="cart/total" style={styles.total}>{`Total: ${formatPrice(cartTotal(items))}`}</Text>
      {flags.newCheckout && items.length > 0 ? <Button id="cart/checkout" label="Checkout" onPress={clear} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  row: { fontSize: 16, paddingVertical: 8 },
  total: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
});
