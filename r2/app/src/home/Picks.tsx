import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { Product } from '../api';
import { formatPrice } from '../price';
import { card } from './card';

const PICKS = ['p2', 'p5', 'p8'];

export function Picks({ items, onOpen }: { items: Product[]; onOpen: (id: string) => void }) {
  return (
    <ScrollView horizontal style={card.strip} showsHorizontalScrollIndicator={false}>
      {items.filter(p => PICKS.includes(p.id)).map(p => (
        <Pressable key={p.id} testID={`picks/${p.id}`} style={card.box} onPress={() => onOpen(p.id)}>
          <Text style={card.name}>{p.name}</Text>
          <Text testID={`picks/${p.id}/price`} style={card.price}>{formatPrice(p.price)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
