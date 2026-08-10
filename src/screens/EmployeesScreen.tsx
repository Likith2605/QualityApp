import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { addEmployee, adminCount, deleteEmployee, employeeIdExists, getEmployees, updateEmployee } from '../db/repo';
import type { Employee, Role } from '../db/types';
import { ROLE_LABEL, ROLES } from '../db/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { Badge, Button, Card, EmptyState, Field, Loading, Screen, SectionTitle } from '../components/ui';

export default function EmployeesScreen() {
  const db = useSQLiteContext();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [empId, setEmpId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('designer');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getEmployees(db);
    setEmployees(list);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!showForm) {
      setEditingId(null);
      setEmpId('');
      setName('');
      setPassword('');
      setRole('designer');
    }
  }, [showForm]);

  const startAdd = () => {
    setEditingId(null);
    setEmpId('');
    setName('');
    setPassword('');
    setRole('designer');
    setShowForm(true);
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setEmpId(emp.employee_id);
    setName(emp.name);
    setPassword(emp.password);
    setRole(emp.role);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!empId.trim() || !name.trim() || !password) {
      Alert.alert('Missing information', 'Employee ID, Name and Password are required.');
      return;
    }
    if (await employeeIdExists(db, empId, editingId ?? undefined)) {
      Alert.alert('Duplicate', 'An employee with this Employee ID already exists.');
      return;
    }
    if (editingId && editingId === user?.id && user?.role === 'admin' && role !== 'admin') {
      const admins = await adminCount(db);
      if (admins <= 1) {
        Alert.alert('Cannot change', 'You are the last admin. Change your role back to admin.');
        return;
      }
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateEmployee(db, editingId, {
          employee_id: empId,
          name,
          password,
          role,
        });
      } else {
        await addEmployee(db, { employee_id: empId, name, password, role });
      }
      setShowForm(false);
      load();
    } catch {
      Alert.alert('Error', 'Could not save the employee.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (emp: Employee) => {
    if (emp.id === user?.id) {
      Alert.alert('Cannot delete', 'You cannot delete your own account.');
      return;
    }
    Alert.alert('Delete employee', `Delete ${emp.name} (${emp.employee_id})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (emp.role === 'admin') {
            const admins = await adminCount(db);
            if (admins <= 1) {
              Alert.alert('Cannot delete', 'At least one admin must remain.');
              return;
            }
          }
          await deleteEmployee(db, emp.id);
          load();
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {!showForm && (
          <View style={styles.topBar}>
            <Button title="+ Add Employee" onPress={startAdd} />
          </View>
        )}

        {showForm && (
          <Card style={{ marginTop: 16 }}>
            <Text style={styles.formTitle}>{editingId ? 'Edit Employee' : 'Add Employee'}</Text>
            <Field label="Employee ID *" value={empId} onChangeText={setEmpId} autoCapitalize="characters" placeholder="e.g. QC002" />
            <Field label="Name *" value={name} onChangeText={setName} placeholder="Full name" />
            <Field label="Password *" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />

            <Text style={styles.roleLabel}>Role</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <View key={r} style={{ flex: 1, marginHorizontal: 3 }}>
                  <Button
                    title={ROLE_LABEL[r]}
                    onPress={() => setRole(r)}
                    variant={role === r ? 'primary' : 'ghost'}
                  />
                </View>
              ))}
            </View>

            <Button title={editingId ? 'Update Employee' : 'Save Employee'} onPress={handleSave} loading={saving} variant="success" style={{ marginTop: 10 }} />
            <Button title="Cancel" onPress={() => setShowForm(false)} variant="outline" />
          </Card>
        )}

        <SectionTitle>Employees</SectionTitle>

        {loading ? (
          <Loading />
        ) : employees.length === 0 ? (
          <EmptyState message="No employees yet." />
        ) : (
          employees.map((emp) => (
            <Card key={emp.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {emp.name}
                    {emp.id === user?.id ? '  (You)' : ''}
                  </Text>
                  <Text style={styles.meta}>{emp.employee_id}</Text>
                </View>
                <Badge
                  text={ROLE_LABEL[emp.role]}
                  tone={emp.role === 'admin' ? 'danger' : emp.role === 'designer' ? 'neutral' : 'success'}
                />
              </View>
              <View style={styles.actions}>
                <Text style={styles.actionText} onPress={() => startEdit(emp)}>
                  Edit
                </Text>
                <Text style={[styles.actionText, styles.deleteText]} onPress={() => handleDelete(emp)}>
                  Delete
                </Text>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    margin: 16,
    marginBottom: 0,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primaryDark,
    marginBottom: 12,
  },
  roleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  roleRow: {
    flexDirection: 'row',
    marginHorizontal: -3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  actionText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 20,
  },
  deleteText: {
    color: colors.danger,
  },
});
