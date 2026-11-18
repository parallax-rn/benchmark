import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { Product } from '../api';
import { card } from './card';
import { dealPrice } from './deal-price';

const DEALS = ['p7', 'p2', 'p3'];

export function Deals({ items, onOpen }: { items: Product[]; onOpen: (id: string) => void }) {
  return (
    <ScrollView horizontal style={card.strip} showsHorizontalScrollIndicator={false}>
      {DEALS.map(id => items.find(p => p.id === id)).filter((p): p is Product => p !== undefined).map(p => (
        <Pressable key={p.id} testID={`deals/${p.id}`} style={card.box} onPress={() => onOpen(p.id)}>
          <Text style={card.name}>{p.name}</Text>
          <Text testID={`deals/${p.id}/price`} style={card.price}>{dealPrice(p.price)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
