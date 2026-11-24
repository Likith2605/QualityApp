import { LOGO_DATA_URI } from './logoDataUri';

let cached: string | null = null;

export async function getLogoDataUri(): Promise<string> {
  if (cached) {
    return cached;
  }
  cached = LOGO_DATA_URI;
  return cached;
}
