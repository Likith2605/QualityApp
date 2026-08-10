import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SQLiteProvider } from 'expo-sqlite';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { DATABASE_NAME, migrateDbIfNeeded } from './src/db/database';
import type { RootStackParamList } from './src/navigation/types';
import { colors } from './src/theme';
import MainTabs from './src/components/MainTabs';
import LoginScreen from './src/screens/LoginScreen';
import DrawingFormScreen from './src/screens/DrawingFormScreen';
import DrawingDetailScreen from './src/screens/DrawingDetailScreen';
import DimensionFormScreen from './src/screens/DimensionFormScreen';
import QCCheckScreen from './src/screens/QCCheckScreen';
import CheckReportScreen from './src/screens/CheckReportScreen';
import ReportViewScreen from './src/screens/ReportViewScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

function RootNavigator() {
  const { user, ready } = useAuth();

  if (!ready) {
    return <Splash />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerTintColor: colors.primaryDark,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="DrawingForm" component={DrawingFormScreen} options={{ title: 'Drawing' }} />
            <Stack.Screen name="DrawingDetail" component={DrawingDetailScreen} options={{ title: 'Drawing Details' }} />
            <Stack.Screen name="DimensionForm" component={DimensionFormScreen} options={{ title: 'Measurement & Tolerance' }} />
            <Stack.Screen name="QCCheck" component={QCCheckScreen} options={{ title: 'Quality Check' }} />
            <Stack.Screen name="CheckReport" component={CheckReportScreen} options={{ title: 'Inspection Report' }} />
            <Stack.Screen name="ReportView" component={ReportViewScreen} options={{ title: 'Report Preview' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </AuthProvider>
    </SQLiteProvider>
  );
}
