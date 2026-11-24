import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SQLiteProvider } from 'expo-sqlite';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AutoSyncProvider } from './src/context/AutoSyncContext';
import { DATABASE_NAME, migrateDbIfNeeded } from './src/db/database';
import { migrateDatabaseFile } from './src/db/storage';
import type { RootStackParamList } from './src/navigation/types';
import { colors } from './src/theme';
import MainTabs from './src/components/MainTabs';
import LoginScreen from './src/screens/LoginScreen';
import DrawingFormScreen from './src/screens/DrawingFormScreen';
import DrawingDetailScreen from './src/screens/DrawingDetailScreen';
import BallooningScreen from './src/screens/BallooningScreen';
import DimensionFormScreen from './src/screens/DimensionFormScreen';
import QCCheckScreen from './src/screens/QCCheckScreen';
import CheckReportScreen from './src/screens/CheckReportScreen';
import ReportViewScreen from './src/screens/ReportViewScreen';
import OverallReportScreen from './src/screens/OverallReportScreen';
import OverallReportViewScreen from './src/screens/OverallReportViewScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import DispatchStickerScreen from './src/screens/DispatchStickerScreen';

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
            <Stack.Screen name="Ballooning" component={BallooningScreen} options={{ title: 'Ballooning' }} />
            <Stack.Screen name="DimensionForm" component={DimensionFormScreen} options={{ title: 'Measurement & Tolerance' }} />
            <Stack.Screen name="QCCheck" component={QCCheckScreen} options={{ title: 'Quality Check' }} />
            <Stack.Screen name="CheckReport" component={CheckReportScreen} options={{ title: 'Inspection Report' }} />
            <Stack.Screen name="ReportView" component={ReportViewScreen} options={{ title: 'Report Preview' }} />
            <Stack.Screen name="OverallReport" component={OverallReportScreen} options={{ title: 'Overall Report' }} />
            <Stack.Screen name="OverallReportView" component={OverallReportViewScreen} options={{ title: 'Overall Report Preview' }} />
            <Stack.Screen name="Dispatch" component={DispatchScreen} options={{ title: 'Dispatch' }} />
            <Stack.Screen name="DispatchSticker" component={DispatchStickerScreen} options={{ title: 'Dispatch Sticker' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

let dbDirectory: string | undefined;
function resolveDbDirectory(): string | undefined {
  if (dbDirectory === undefined) {
    dbDirectory = migrateDatabaseFile() ?? undefined;
  }
  return dbDirectory;
}

export default function App() {
  return (
    <SQLiteProvider
      databaseName={DATABASE_NAME}
      directory={resolveDbDirectory()}
      onInit={migrateDbIfNeeded}
    >
      <AuthProvider>
        <AutoSyncProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </AutoSyncProvider>
      </AuthProvider>
    </SQLiteProvider>
  );
}
