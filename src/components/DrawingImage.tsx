import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import * as Sharing from 'expo-sharing';
import { colors } from '../theme';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif'];

function isImage(uri: string): boolean {
  const lower = uri.toLowerCase();
  if (/^data:image\//.test(lower)) {
    return true;
  }
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
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

  if (!uri) {
    return null;
  }

  if (isImage(uri)) {
    return (
      <View style={[styles.container, style]}>
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      </View>
    );
  }

  const fileName = uri.split('/').pop() ?? 'drawing.pdf';

  const openFile = async () => {
    if (opening) {
      return;
    }
    setOpening(true);
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: fileName,
        });
      } else {
        Alert.alert(label, fileName);
      }
    } catch {
      Alert.alert('Error', 'Could not open the drawing file.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.fileName} numberOfLines={1}>
        {label}: {fileName}
      </Text>
      <Pressable onPress={openFile} style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}>
        <Text style={styles.openText}>{opening ? 'Opening...' : 'Open Drawing (PDF)'}</Text>
      </Pressable>
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
  openButton: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
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
