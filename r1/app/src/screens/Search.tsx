import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchProducts, type Product } from '../api';
import type { ScreenProps } from '../routes';
import { ProductRow } from './ProductRow';

export function Search({ navigation }: ScreenProps<'Search'>) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let current = true;
    searchProducts(q).then(r => {
      if (current) setResults(r.body);
    });
    return () => {
      current = false;
    };
  }, [q]);
  return (
    <View style={styles.page}>
      <TextInput testID="search/input" value={q} onChangeText={setQ} placeholder="Search products" autoCapitalize="none" autoCorrect={false} style={styles.input} />
      <FlatList
        testID="search/results"
        data={results}
        keyExtractor={p => p.id}
        ListEmptyComponent={<Text style={styles.empty}>{q ? 'No results' : 'Type to search'}</Text>}
        renderItem={({ item }) => <ProductRow item={item} onPress={() => navigation.navigate('Product', { id: item.id })} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  input: { margin: 16, padding: 12, borderWidth: 1, borderColor: '#bbb', borderRadius: 8, fontSize: 16 },
  empty: { padding: 16, color: '#777' },
});
