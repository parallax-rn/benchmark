import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export function Button({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  return (
    <Pressable testID={id} onPress={onPress} style={styles.btn}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: '#1f6feb', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginVertical: 6, alignItems: 'center' },
  text: { color: 'white', fontSize: 16, fontWeight: '600' },
});
