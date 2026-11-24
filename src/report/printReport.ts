import { Alert, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { openHtmlOnWeb } from './webPrint';

export async function exportReportPdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    openHtmlOnWeb(html, false);
    Alert.alert(
      'Export PDF',
      'Report opened in a new tab. Use the browser print dialog (Ctrl+P) and choose "Save as PDF".'
    );
    return;
  }
  // 1) Generate the PDF and wait until it has finished rendering.
  //    We request base64 because expo-print writes its output into the host
  //    cache (`cache/Print`) which Expo Go's permission service will not let
  //    any FileSystem API read ("Location ... isn't readable"). The base64
  //    payload is read natively inside the print module, so it always works.
  let base64Pdf: string;
  try {
    const result = await Print.printToFileAsync({ html, base64: true });
    base64Pdf = result.base64 ?? '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[exportReportPdf] PDF generation failed:', msg);
    throw new Error(`PDF generation failed: ${msg}`);
  }

  if (!base64Pdf) {
    throw new Error('PDF generation did not return the PDF data.');
  }

  // 2) Write the PDF bytes into the app's own cache (writable + shareable path).
  const safeTitle =
    title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '') || 'quality-report';
  const destUri = `${LegacyFileSystem.cacheDirectory}${safeTitle}-${Date.now()}.pdf`;
  try {
    await LegacyFileSystem.writeAsStringAsync(destUri, base64Pdf, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[exportReportPdf] Could not save the PDF file:', msg);
    throw new Error(`The PDF was generated but could not be saved: ${msg}`);
  }

  // 3) Validate the saved file before sharing.
  const info = await LegacyFileSystem.getInfoAsync(destUri);
  if (!info.exists || (info.size ?? 0) <= 0) {
    throw new Error('The generated PDF file is missing or empty.');
  }

  // 4) Wait for the share sheet availability and open it with the PDF MIME type.
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(destUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: title,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[exportReportPdf] Sharing failed:', msg);
    throw new Error(`The PDF was saved to ${destUri} but could not be shared: ${msg}`);
  }
}

export async function printReport(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    openHtmlOnWeb(html, true);
    return;
  }
  await Print.printAsync({ html });
}
