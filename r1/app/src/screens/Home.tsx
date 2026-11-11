import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Home({ navigation }: ScreenProps<'Home'>) {
  return (
    <View style={styles.page}>
      <Button id="home/products" label="Products" onPress={() => navigation.navigate('Products')} />
      <Button id="home/search" label="Search" onPress={() => navigation.navigate('Search')} />
      <Button id="home/cart" label="Cart" onPress={() => navigation.navigate('Cart')} />
      <Button id="home/settings" label="Settings" onPress={() => navigation.navigate('Settings')} />
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 16 } });
