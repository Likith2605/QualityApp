import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export default function ReportHtmlView({ html }: { html: string }) {
  return (
    <WebView
      style={styles.webview}
      originWhitelist={['*']}
      source={{ html }}
      textZoom={80}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
