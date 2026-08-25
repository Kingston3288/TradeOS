export interface AuthConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  isConfigured: boolean;
  missing: string[];
}

type Environment = Record<string, string | undefined>;

export function createAuthConfig(env: Environment = readRuntimeEnvironment()): AuthConfig {
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  const missing = [
    supabaseUrl ? null : 'EXPO_PUBLIC_SUPABASE_URL',
    supabaseAnonKey ? null : 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter((value): value is string => Boolean(value));

  return {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured: missing.length === 0,
    missing,
  };
}

export function isDatabaseConfigured(config = createAuthConfig()): boolean {
  return config.isConfigured;
}

function readRuntimeEnvironment(): Environment {
  const raw: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? (process.env as Record<string, string | undefined>) : {};
  return {
    EXPO_PUBLIC_SUPABASE_URL: raw.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: raw.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}
