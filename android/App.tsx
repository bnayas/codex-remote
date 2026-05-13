import React, { useEffect, useState } from 'react';
import { View, StatusBar, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootStackParamList } from './src/types';
import { Colors, Fonts } from './src/theme';
import { loadCredentials, isConfigured } from './src/api';

import SetupScreen from './src/screens/SetupScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import ProjectDetailScreen from './src/screens/ProjectDetailScreen';
import SessionScreen from './src/screens/SessionScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const NavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.bg,
    card: Colors.bgCard,
    text: Colors.textBright,
    border: Colors.border,
    primary: Colors.accent,
    notification: Colors.accent,
  },
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('Setup');

  useEffect(() => {
    loadCredentials().then(() => {
      setInitialRoute(isConfigured() ? 'Projects' : 'Setup');
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <NavigationContainer theme={NavTheme}>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerStyle: { backgroundColor: Colors.bgCard },
            headerTintColor: Colors.accent,
            headerTitleStyle: {
              fontFamily: Fonts.mono,
              fontSize: 14,
              color: Colors.textBright,
            },
            headerShadowVisible: false,
            headerBackTitleVisible: false,
            contentStyle: { backgroundColor: Colors.bg },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen
            name="Setup"
            component={SetupScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Projects"
            component={ProjectsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ProjectDetail"
            component={ProjectDetailScreen}
            options={({ route }) => ({ title: route.params.project.name })}
          />
          <Stack.Screen
            name="Session"
            component={SessionScreen}
            options={({ route }) => ({
              title: route.params.session.title ?? route.params.session.id.slice(0, 14),
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
