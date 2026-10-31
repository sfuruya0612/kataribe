import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LlmKeyStatus, LlmProvider } from '../shared/types';

export type SecretCrypto = {
  isAvailable: () => Promise<boolean>;
  encrypt: (plainText: string) => Promise<Buffer>;
  decrypt: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export type ApiKeyErrorCode =
  | 'keychain-unavailable'
  | 'host-mismatch'
  | 'invalid-key'
  | 'invalid-config'
  | 'decrypt-failed';

export class ApiKeyError extends Error {
  readonly code: ApiKeyErrorCode;

  constructor(code: ApiKeyErrorCode, message: string) {
    super(message);
    this.name = 'ApiKeyError';
    this.code = code;
  }
}

type StoredKey = {
  version: 1;
  profile_id?: string;
  provider?: LlmProvider;
  host: string;
  encrypted: string;
  created_at: string;
};

type ConfigFile = {
  schema_version: 1;
  api_keys: Record<string, StoredKey>;
};

export type ApiKeyStoreOptions = {
  filePath: string;
  crypto: SecretCrypto;
  now?: () => Date;
};

function hostForBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return '';
  }
}

function emptyConfig(): ConfigFile {
  return { schema_version: 1, api_keys: {} };
}

export class ApiKeyStore {
  private readonly filePath: string;
  private readonly crypto: SecretCrypto;
  private readonly now: () => Date;
  private config: ConfigFile = emptyConfig();
  private loadError: string | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(options: ApiKeyStoreOptions) {
    this.filePath = options.filePath;
    this.crypto = options.crypto;
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    this.loadError = null;
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as ConfigFile;
      if (parsed.schema_version !== 1 || typeof parsed.api_keys !== 'object') {
        throw new Error('unsupported config schema');
      }
      this.config = {
        schema_version: 1,
        api_keys: parsed.api_keys ?? {},
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        this.config = emptyConfig();
        return;
      }
      this.config = emptyConfig();
      this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  async status(profileId: string, baseUrl: string): Promise<LlmKeyStatus> {
    const available = await this.crypto.isAvailable().catch((error: unknown) => {
      this.loadError = error instanceof Error ? error.message : String(error);
      return false;
    });
    const stored = this.config.api_keys[profileId] ?? null;
    return {
      profileId,
      configured: stored !== null,
      host: stored?.host ?? null,
      keychainAvailable: available,
      keychainError: available ? this.loadError : 'macOS Keychain is not available',
    };
  }

  hostMatches(
    profileId: string,
    baseUrl: string,
    provider?: LlmProvider,
  ): boolean {
    const stored = this.config.api_keys[profileId];
    if (!stored) {
      return false;
    }
    if (provider && stored.provider && stored.provider !== provider) {
      return false;
    }
    return stored.host === hostForBaseUrl(baseUrl);
  }

  async setKey(
    profileId: string,
    provider: LlmProvider,
    apiKey: string,
    baseUrl: string,
  ): Promise<LlmKeyStatus> {
    const key = apiKey.trim();
    if (key.length === 0 || key.length > 10_000) {
      throw new ApiKeyError('invalid-key', 'API key is empty or too long');
    }
    if (!profileId) {
      throw new ApiKeyError('invalid-config', 'profile ID is empty');
    }
    const host = hostForBaseUrl(baseUrl);
    if (!host) {
      throw new ApiKeyError('invalid-config', 'endpoint URL is invalid');
    }
    const available = await this.crypto.isAvailable();
    if (!available) {
      throw new ApiKeyError(
        'keychain-unavailable',
        'macOS Keychain is not available; API keys cannot be stored',
      );
    }
    const encrypted = await this.crypto.encrypt(key);
    await this.enqueue(async () => {
      this.config.api_keys[profileId] = {
        version: 1,
        profile_id: profileId,
        provider,
        host,
        encrypted: encrypted.toString('base64'),
        created_at: this.now().toISOString(),
      };
      await this.write();
      this.loadError = null;
    });
    return this.status(profileId, baseUrl);
  }

  async renameKey(fromProfileId: string, toProfileId: string): Promise<void> {
    if (fromProfileId === toProfileId) {
      return;
    }
    await this.enqueue(async () => {
      const stored = this.config.api_keys[fromProfileId];
      if (!stored) {
        return;
      }
      delete this.config.api_keys[fromProfileId];
      this.config.api_keys[toProfileId] = {
        ...stored,
        profile_id: toProfileId,
      };
      await this.write();
    });
  }

  async clearKey(profileId: string): Promise<void> {
    await this.enqueue(async () => {
      if (this.config.api_keys[profileId]) {
        delete this.config.api_keys[profileId];
        await this.write();
      }
    });
  }

  async getKey(
    profileId: string,
    baseUrl: string,
    provider?: LlmProvider,
  ): Promise<string | null> {
    const stored = this.config.api_keys[profileId];
    if (!stored) {
      return null;
    }
    if (
      stored.host !== hostForBaseUrl(baseUrl) ||
      (provider && stored.provider && stored.provider !== provider)
    ) {
      throw new ApiKeyError(
        'host-mismatch',
        'endpoint host or provider changed; enter the API key again',
      );
    }
    const available = await this.crypto.isAvailable();
    if (!available) {
      throw new ApiKeyError(
        'keychain-unavailable',
        'macOS Keychain is not available; cannot decrypt the API key',
      );
    }
    let decrypted: { result: string; shouldReEncrypt: boolean };
    try {
      decrypted = await this.crypto.decrypt(Buffer.from(stored.encrypted, 'base64'));
      if (decrypted.shouldReEncrypt) {
        const second = await this.crypto.decrypt(
          Buffer.from(stored.encrypted, 'base64'),
        );
        decrypted = { result: second.result, shouldReEncrypt: false };
        const reEncrypted = await this.crypto.encrypt(second.result);
        await this.enqueue(async () => {
          const current = this.config.api_keys[profileId];
          if (current) {
            current.encrypted = reEncrypted.toString('base64');
            await this.write();
          }
        });
      }
    } catch (error) {
      if (error instanceof ApiKeyError) {
        throw error;
      }
      throw new ApiKeyError(
        'decrypt-failed',
        `failed to decrypt the API key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!decrypted.result) {
      throw new ApiKeyError('decrypt-failed', 'decrypted API key is empty');
    }
    return decrypted.result;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async write(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(this.config, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tempPath, 0o600);
    await rename(tempPath, this.filePath);
  }
}
