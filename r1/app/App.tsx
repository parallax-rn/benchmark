import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Cart } from './src/screens/Cart';
import { Home } from './src/screens/Home';
import { Product } from './src/screens/Product';
import { Products } from './src/screens/Products';
import { Search } from './src/screens/Search';
import { Settings } from './src/screens/Settings';
import type { Routes } from './src/routes';

const Stack = createNativeStackNavigator<Routes>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={Home} options={{ title: 'Shop' }} />
        <Stack.Screen name="Products" component={Products} />
        <Stack.Screen name="Product" component={Product} options={{ headerShown: false }} />
        <Stack.Screen name="Search" component={Search} />
        <Stack.Screen name="Cart" component={Cart} />
        <Stack.Screen name="Settings" component={Settings} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
