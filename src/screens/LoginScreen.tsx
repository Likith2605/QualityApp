import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { APP_TITLE } from '../config';
import { Button, Field } from '../components/ui';
import { getServerUrl, setServerUrl, connectToServer, testServerConnection } from '../db/sync';
import { refreshRealtime } from '../db/realtime';

const logoSource = require('../../assets/new-logo.png');

export default function LoginScreen() {
  const { completeLogin, login } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrlInput] = useState('');
  const [serverSaved, setServerSaved] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      const url = await getServerUrl();
      setServerUrlInput(url);
      setServerSaved(url.length > 0);
    })();
  }, []);

  const handleSaveServer = async () => {
    const clean = serverUrl.trim();
    if (clean && !/^https?:\/\//i.test(clean)) {
      Alert.alert('Invalid URL', 'Server address must start with http:// or https://');
      return;
    }
    await setServerUrl(clean);
    setServerSaved(clean.length > 0);
    if (clean) {
      await handleTestConnection(clean);
    } else {
      setTestResult('');
    }
    refreshRealtime();
    Alert.alert('Sync server', clean.length > 0 ? 'Server address saved.' : 'Sync server cleared.');
  };

  const handleTestConnection = async (url?: string) => {
    setTesting(true);
    setTestResult('');
    const res = await testServerConnection(url ?? serverUrl);
    setTestResult(res.message);
    setTesting(false);
  };

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const { error, employee } = await login(employeeId, password);
      if (error || !employee) {
        setError(error ?? 'Invalid Employee ID or Password');
        return;
      }

      let offlineMessage: string | null = null;
      if (await getServerUrl()) {
        const result = await connectToServer(employee);
        if (!result.ok) {
          offlineMessage = `Logged in offline. Sync server: ${result.message}`;
        }
      }

      await completeLogin(employee);
      if (offlineMessage) {
        Alert.alert('Sync server', offlineMessage);
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <Image source={logoSource} style={styles.logo} resizeMode="contain" />
        <Text style={styles.appTitle}>{APP_TITLE}</Text>
        <Text style={styles.subtitle}>Quality Control</Text>
      </View>

      <View style={styles.form}>
        <Field
          label="Employee ID"
          value={employeeId}
          onChangeText={setEmployeeId}
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

        <Pressable style={styles.serverToggle} onPress={() => setShowServer((v) => !v)}>
          <Text style={styles.serverToggleText}>
            {showServer ? 'Hide sync settings' : 'Sync settings'}
            {serverSaved ? ' · configured' : ' · not configured'}
          </Text>
        </Pressable>

        {showServer ? (
          <View style={styles.serverBox}>
            <Field
              label="Sync server address"
              value={serverUrl}
              onChangeText={setServerUrlInput}
              placeholder="http://192.168.1.10:4000"
              autoCapitalize="none"
            />
            <Button title="Save Server Address" onPress={handleSaveServer} variant="outline" />
            <Button
              title={testing ? 'Testing...' : 'Test Connection'}
              onPress={() => handleTestConnection()}
              variant="ghost"
              loading={testing}
            />
            {testResult ? (
              <Text style={[styles.hint, testResult === 'Connected to server' && styles.testOk]}>
                {testResult}
              </Text>
            ) : null}
            <Text style={styles.hint}>
              Same address on every device. The server syncs drawings and inspections so all
              devices see the same data. Works offline too - data syncs when you are back online.
            </Text>
          </View>
        ) : null}
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
  logo: {
    height: 80,
    width: 130,
    marginBottom: 14,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primaryDark,
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
  serverToggle: {
    marginTop: 10,
    alignItems: 'center',
  },
  serverToggleText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  serverBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    lineHeight: 17,
  },
  testOk: {
    color: colors.success,
    fontWeight: '700',
  },
});
