import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Pressable, Text } from 'react-native';
import type { MainTabParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABEL } from '../db/types';
import { colors } from '../theme';
import DesignerHomeScreen from '../screens/DesignerHomeScreen';
import QCHomeScreen from '../screens/QCHomeScreen';
import HistoryScreen from '../screens/HistoryScreen';
import EmployeesScreen from '../screens/EmployeesScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <Pressable onPress={() => logout()} style={{ marginRight: 16, padding: 4 }}>
      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 14 }}>Logout</Text>
    </Pressable>
  );
}

export default function MainTabs() {
  const { user } = useAuth();
  const role = user?.role ?? 'designer';

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerRight: () => <LogoutButton />,
        headerTintColor: colors.primaryDark,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      {(role === 'designer' || role === 'admin') && (
        <Tab.Screen name="Drawings" component={DesignerHomeScreen} options={{ title: 'Drawings' }} />
      )}
      {(role === 'qc' || role === 'admin') && (
        <Tab.Screen name="Inspect" component={QCHomeScreen} options={{ title: 'Inspect' }} />
      )}
      {(role === 'qc' || role === 'admin') && (
        <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      )}
      {role === 'admin' && (
        <Tab.Screen name="Employees" component={EmployeesScreen} options={{ title: 'Employees' }} />
      )}
    </Tab.Navigator>
  );
}

export function currentRoleLabel(role: 'admin' | 'designer' | 'qc'): string {
  return ROLE_LABEL[role];
}
