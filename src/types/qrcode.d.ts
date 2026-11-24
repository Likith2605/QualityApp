declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: string;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }

  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;

  const QRCode: {
    toString: typeof toString;
  };

  export default QRCode;
}
