import { useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { File } from 'expo-file-system';
import { colors } from '../theme';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif'];

function isImage(uri: string): boolean {
  const lower = uri.toLowerCase();
  if (/^data:image\//.test(lower)) {
    return true;
  }
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function openOnWeb(uri: string): void {
  const win = window.open(uri, '_blank');
  if (!win) {
    throw new Error('The browser blocked the file window. Allow pop-ups for this site and try again.');
  }
}

export default function DrawingImage({
  uri,
  label = 'Drawing',
  style,
}: {
  uri?: string | null;
  label?: string;
  style?: ViewStyle;
}) {
  const [opening, setOpening] = useState(false);
  const [sharing, setSharing] = useState(false);

  if (!uri) {
    return null;
  }

  const fileName = uri.split('/').pop() ?? 'drawing.pdf';

  const shareFile = async () => {
    if (sharing) {
      return;
    }
    setSharing(true);
    try {
      if (Platform.OS === 'web') {
        openOnWeb(uri);
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (available) {
        const mimeType = isImage(uri) ? 'image/*' : 'application/pdf';
        await Sharing.shareAsync(uri, {
          mimeType,
          dialogTitle: fileName,
        });
      } else {
        Alert.alert(label, fileName);
      }
    } catch {
      Alert.alert('Error', 'Could not share the file.');
    } finally {
      setSharing(false);
    }
  };

  const openFile = async () => {
    if (opening) {
      return;
    }
    setOpening(true);
    try {
      if (Platform.OS === 'web') {
        openOnWeb(uri);
      } else if (Platform.OS === 'android') {
        let data = uri;
        try {
          data = new File(uri).contentUri;
        } catch {
          // fall back to the raw uri
        }
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data,
          type: 'application/pdf',
          flags: 1,
        });
      } else {
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: fileName,
          });
        } else {
          Alert.alert(label, fileName);
        }
      }
    } catch {
      Alert.alert('Error', 'Could not open the drawing file.');
    } finally {
      setOpening(false);
    }
  };

  if (isImage(uri)) {
    return (
      <View style={[styles.container, style]}>
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        <Pressable
          onPress={shareFile}
          style={({ pressed }) => [styles.openButton, styles.shareButton, pressed && styles.pressed]}
        >
          <Text style={styles.openText}>{sharing ? 'Sharing...' : 'Share Image'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.fileName} numberOfLines={1}>
        {label}: {fileName}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={openFile}
          style={({ pressed }) => [styles.openButton, styles.actionsPrimary, pressed && styles.pressed]}
        >
          <Text style={styles.openText}>{opening ? 'Opening...' : 'View Drawing'}</Text>
        </Pressable>
        <Pressable
          onPress={shareFile}
          style={({ pressed }) => [styles.openButton, styles.actionsSecondary, pressed && styles.pressed]}
        >
          <Text style={styles.openText}>{sharing ? 'Sharing...' : 'Share'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 260,
    backgroundColor: colors.background,
  },
  fileName: {
    padding: 10,
    fontSize: 12,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
  },
  actionsPrimary: {
    flex: 1,
  },
  actionsSecondary: {
    flex: 1,
    backgroundColor: colors.primaryDark,
  },
  openButton: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  shareButton: {
    backgroundColor: colors.primaryDark,
  },
  openText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.85,
  },
});
