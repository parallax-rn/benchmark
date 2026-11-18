import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { Product } from '../api';
import { parsePrice } from '../price';
import { card } from './card';

const POPULAR = ['p6', 'p4', 'p1'];
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function Popular({ items, onOpen }: { items: Product[]; onOpen: (id: string) => void }) {
  return (
    <ScrollView horizontal style={card.strip} showsHorizontalScrollIndicator={false}>
      {POPULAR.map(id => items.find(p => p.id === id)).filter((p): p is Product => p !== undefined).map(p => (
        <Pressable key={p.id} testID={`popular/${p.id}`} style={card.box} onPress={() => onOpen(p.id)}>
          <Text style={card.name}>{p.name}</Text>
          <Text testID={`popular/${p.id}/price`} style={card.price}>{usd.format(parsePrice(p.price))}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
