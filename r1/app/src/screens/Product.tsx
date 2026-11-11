import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getProduct, type Product as P } from '../api';
import { useCart } from '../cart';
import { formatPrice } from '../price';
import { PromoBadge } from '../PromoBadge';
import { daysAgo } from '../relative';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Product({ route, navigation }: ScreenProps<'Product'>) {
  const [item, setItem] = useState<P | null>(null);
  const add = useCart(s => s.add);
  const count = useCart(s => s.items.reduce((n, i) => n + i.qty, 0));
  useEffect(() => {
    getProduct(route.params.id).then(r => setItem(r.body));
  }, [route.params.id]);
  if (!item) return <Text style={styles.loading}>Loading…</Text>;
  return (
    <View style={styles.page}>
      <View style={styles.picture} />
      <Text style={styles.title}>{item.name}</Text>
      <Text style={styles.price}>{formatPrice(item.price)}</Text>
      <Button id="product/add" label="Add to cart" onPress={() => add(item)} />
      <Text testID="product/count">{`In cart: ${count}`}</Text>
      <Text testID="product/restocked">{`Restocked ${daysAgo(item.restockedAt)}`}</Text>
      <Text style={styles.description}>{item.description}</Text>
      <Button id="product/back" label="Back" onPress={() => navigation.goBack()} />
      <PromoBadge label="SALE" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 16, paddingTop: 80 },
  page: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  picture: { height: 180, backgroundColor: '#e6e6e6', borderRadius: 8 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 12 },
  price: { fontSize: 18, marginVertical: 6 },
  description: { color: '#555', marginVertical: 12 },
});
