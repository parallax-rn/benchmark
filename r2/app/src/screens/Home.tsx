import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { getProducts, type Product } from '../api';
import { Deals } from '../home/Deals';
import { Picks } from '../home/Picks';
import { Popular } from '../home/Popular';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Home({ navigation }: ScreenProps<'Home'>) {
  const [items, setItems] = useState<Product[]>([]);
  useEffect(() => {
    getProducts().then(r => setItems(r.body));
  }, []);
  const open = (id: string) => navigation.navigate('Product', { id });
  return (
    <ScrollView style={styles.page}>
      <Button id="home/products" label="Products" onPress={() => navigation.navigate('Products')} />
      <Button id="home/search" label="Search" onPress={() => navigation.navigate('Search')} />
      <Button id="home/cart" label="Cart" onPress={() => navigation.navigate('Cart')} />
      <Button id="home/settings" label="Settings" onPress={() => navigation.navigate('Settings')} />
      <Picks items={items} onOpen={open} />
      <Popular items={items} onOpen={open} />
      <Deals items={items} onOpen={open} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 16 } });
