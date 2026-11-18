import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCart } from '../cart';
import { dec, inc, useCartTotal } from '../cartActions';
import { applyCoupon } from '../coupon';
import { useFlags } from '../flags';
import { formatPrice } from '../price';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Cart(_: ScreenProps<'Cart'>) {
  const items = useCart(s => s.items);
  const clear = useCart(s => s.clear);
  const flags = useFlags();
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [message, setMessage] = useState('');
  const total = useCartTotal(items, discount);
  const apply = async () => {
    setMessage('');
    const r = await applyCoupon(code.trim());
    if (r.discount !== undefined) {
      setDiscount(r.discount);
      setMessage(`Coupon applied: ${Math.round(r.discount * 100)}% off`);
    } else if (r.error) setMessage(r.error);
  };
  return (
    <View style={styles.page}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        ListEmptyComponent={<Text>Your cart is empty</Text>}
        renderItem={({ item }) => (
          <View style={styles.line}>
            <Text style={styles.row}>{`${item.name} x${item.qty}  ${formatPrice(item.price)}`}</Text>
            <Pressable testID={`cart/dec/${item.id}`} onPress={() => dec(item.id)} style={styles.step}><Text style={styles.stepText}>−</Text></Pressable>
            <Pressable testID={`cart/inc/${item.id}`} onPress={() => inc(item.id)} style={styles.step}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        )}
      />
      <View style={styles.coupon}>
        <TextInput testID="cart/coupon" value={code} onChangeText={setCode} placeholder="Coupon code" autoCapitalize="characters" autoCorrect={false} style={styles.input} />
        <Button id="cart/apply" label="Apply" onPress={apply} />
      </View>
      <Text testID="cart/coupon-message">{message}</Text>
      <Text testID="cart/total" style={styles.total}>{`Total: ${formatPrice(total)}`}</Text>
      {flags.newCheckout && items.length > 0 ? <Button id="cart/checkout" label="Checkout" onPress={clear} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  line: { flexDirection: 'row', alignItems: 'center' },
  row: { flex: 1, fontSize: 16, paddingVertical: 8 },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e6e6e6', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  stepText: { fontSize: 20 },
  coupon: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  input: { flex: 1, marginRight: 8, padding: 12, borderWidth: 1, borderColor: '#bbb', borderRadius: 8, fontSize: 16 },
  total: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
});
