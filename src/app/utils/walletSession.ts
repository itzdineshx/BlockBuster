export type AuthType = "credentials" | "wallet";

export interface AppSession {
  authType: AuthType;
  email?: string;
  walletAddress?: string;
  connectedAt: string;
}

const SESSION_KEY = "blockbuster.session";

export function getSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSession;
    if (!parsed?.authType || !parsed?.connectedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCredentialSession(email: string): void {
  const session: AppSession = {
    authType: "credentials",
    email,
    connectedAt: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function setWalletSession(walletAddress: string): void {
  const session: AppSession = {
    authType: "wallet",
    walletAddress,
    connectedAt: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
