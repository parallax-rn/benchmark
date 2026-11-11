import React, { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import { getProducts, getStock, type Product } from '../api';
import type { ScreenProps } from '../routes';
import { ProductRow } from './ProductRow';

export function Products({ navigation }: ScreenProps<'Products'>) {
  const [items, setItems] = useState<Product[] | null>(null);
  useEffect(() => {
    getProducts().then(r => setItems(r.body));
    getStock().then(r => setItems(list => list && list.map(p => ({ ...p, stock: r.body[p.id] }))));
  }, []);
  if (!items) return <Text style={{ padding: 16 }}>Loading…</Text>;
  return (
    <FlatList
      testID="products/list"
      data={items}
      keyExtractor={p => p.id}
      renderItem={({ item }) => <ProductRow item={item} stock={item.stock ?? 0} onPress={() => navigation.navigate('Product', { id: item.id })} />}
    />
  );
}
