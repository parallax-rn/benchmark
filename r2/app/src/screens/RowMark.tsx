import React from 'react';
import { StyleSheet, View } from 'react-native';
import { markColor } from '../marks';

export function RowMark({ id }: { id: string }) {
  return <View style={[styles.mark, { backgroundColor: markColor(id) }]} />;
}

const styles = StyleSheet.create({ mark: { width: 12, height: 12, borderRadius: 6, marginRight: 10, alignSelf: 'center' } });
