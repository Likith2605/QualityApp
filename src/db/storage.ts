import { Directory, File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory } from 'expo-sqlite';
import { DATABASE_NAME } from './database';

export const DATA_FOLDER_NAME = 'QualityCheck';

function dirUri(dir: Directory | null): string | null {
  return dir?.uri ?? null;
}

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : uri + '/';
}

export function getDataDirectory(): Directory | null {
  try {
    return new Directory(Paths.document, DATA_FOLDER_NAME);
  } catch {
    return null;
  }
}

export function ensureDataDirectory(): string | null {
  try {
    const dir = getDataDirectory();
    if (!dir) return null;
    dir.create({ intermediates: true, idempotent: true });
    return dirUri(dir);
  } catch {
    return null;
  }
}

export function migrateDatabaseFile(): string | null {
  try {
    const dataDirUri = ensureDataDirectory();
    if (!dataDirUri) return null;
    const dest = new File(dataDirUri, DATABASE_NAME);
    if (dest.exists) {
      return dataDirUri;
    }
    if (defaultDatabaseDirectory) {
      const srcBase = ensureTrailingSlash(defaultDatabaseDirectory) + DATABASE_NAME;
      const src = new File(srcBase);
      if (src.exists) {
        src.copy(dest);
        const srcWal = new File(`${srcBase}-wal`);
        if (srcWal.exists) {
          srcWal.copy(new File(dataDirUri, `${DATABASE_NAME}-wal`));
        }
        const srcShm = new File(`${srcBase}-shm`);
        if (srcShm.exists) {
          srcShm.copy(new File(dataDirUri, `${DATABASE_NAME}-shm`));
        }
      }
    }
    return dataDirUri;
  } catch {
    return null;
  }
}
