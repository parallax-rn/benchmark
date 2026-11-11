import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { getProfile, saveProfile } from '../api';
import type { ScreenProps } from '../routes';
import { Button } from '../ui';

export function Settings(_: ScreenProps<'Settings'>) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    getProfile().then(r => setName(r.body.name));
  }, []);
  const save = async () => {
    setMessage('');
    try {
      const r = await saveProfile(name);
      if (!r.ok || !r.body.data) setMessage(r.body.error ?? `Could not save (${r.status})`);
      else setMessage(`Saved at ${r.body.data.updatedAt}`);
    } catch (e) {
      setMessage(`Could not save: ${String(e)}`);
    }
  };
  return (
    <View style={styles.page}>
      <Text>Display name</Text>
      <TextInput testID="settings/name" value={name} onChangeText={setName} style={styles.input} />
      <Button id="settings/save" label="Save" onPress={save} />
      <Text testID="settings/message">{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  input: { marginVertical: 8, padding: 12, borderWidth: 1, borderColor: '#bbb', borderRadius: 8, fontSize: 16 },
});
