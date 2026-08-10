import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { APP_TITLE, COMPANY_NAME } from '../config';
import { Button, Field } from '../components/ui';

export default function LoginScreen() {
  const { login } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    const err = await login(employeeId, password);
    setLoading(false);
    if (err) {
      setError(err);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <Text style={styles.appTitle}>{APP_TITLE}</Text>
        <Text style={styles.company}>{COMPANY_NAME}</Text>
        <Text style={styles.subtitle}>Employee Sign In</Text>
      </View>

      <View style={styles.form}>
        <Field
          label="Employee ID"
          value={employeeId}
          onChangeText={setEmployeeId}
          placeholder="e.g. DES001"
          autoCapitalize="characters"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter password"
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Sign In" onPress={handleLogin} loading={loading} style={{ marginTop: 8 }} />
      </View>


    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primaryDark,
    textAlign: 'center',
  },
  company: {
    fontSize: 13,
    letterSpacing: 2,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 18,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  hintCard: {
    marginTop: 20,
    alignItems: 'center',
  },
  hintTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
  },
  hintText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
