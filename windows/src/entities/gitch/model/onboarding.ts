/** 앱과 CLI의 계정 설정 계약. 비밀키는 이 응답으로 읽거나 전달하지 않는다. */
export interface GitchAccountInput {
  id: string;
  email: string;
  host: string;
  port: number;
  folder: string | null;
  via: string | null;
}

export interface GitchAccountSetup {
  schemaVersion: 1;
  created: boolean;
  account: GitchAccountInput;
  ssh: {
    alias: string;
    keyExists: boolean;
    aliasConfigured?: boolean;
    publicKey: string | null;
    registrationURL: string;
    authenticated: boolean | null;
    keyProtection: string;
    message: string;
  };
}

export interface GitchDoctor {
  problems: number;
  checks: { section: string; level: string; message: string }[];
}

export interface GitchBrowserLogin {
  schemaVersion: 1;
  session: string;
  state: "pending" | "complete" | "failed" | "cancelled";
  deviceCode: string | null;
  verificationURL: string;
  login: string | null;
  email: string | null;
  message: string;
}

export function parseBrowserLogin(output: string): GitchBrowserLogin | null {
  try {
    const o = JSON.parse(output) as GitchBrowserLogin;
    if (o.schemaVersion !== 1 || typeof o.session !== "string" || !/^[A-Za-z0-9_-]+$/.test(o.session) || !["pending", "complete", "failed", "cancelled"].includes(o.state)) return null;
    if (o.verificationURL !== "https://github.com/login/device" || typeof o.message !== "string") return null;
    if (o.deviceCode !== null && (typeof o.deviceCode !== "string" || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(o.deviceCode))) return null;
    if (!(o.login === null || typeof o.login === "string") || !(o.email === null || typeof o.email === "string")) return null;
    if (o.state === "complete" && (!o.login || !o.email)) return null;
    return o;
  } catch { return null; }
}

export function accountAddArguments(input: GitchAccountInput): string[] {
  return ["add", "--id", input.id.trim(), "--email", input.email.trim(), "--host", input.host.trim(), "--port", String(input.port),
    ...(input.folder ? ["--folder", input.folder] : ["--no-folder"]), ...(input.via ? ["--via", input.via] : []), "--no-setup", "--json", "--yes"];
}

export function parseAccountSetup(output: string): GitchAccountSetup | null {
  try {
    const o = JSON.parse(output) as GitchAccountSetup;
    const a = o.account, s = o.ssh;
    if (o.schemaVersion !== 1 || typeof o.created !== "boolean" || !a || !s) return null;
    if (typeof a.id !== "string" || !a.id || typeof a.email !== "string" || typeof a.host !== "string" || !a.host || !Number.isInteger(a.port) || a.port < 1 || a.port > 65535) return null;
    if (!(a.folder === null || typeof a.folder === "string") || !(a.via === null || typeof a.via === "string")) return null;
    if (typeof s.alias !== "string" || typeof s.keyExists !== "boolean" || typeof s.message !== "string" || typeof s.keyProtection !== "string") return null;
    if (s.authenticated !== null && typeof s.authenticated !== "boolean") return null;
    if (s.publicKey !== null && s.publicKey !== "" && (typeof s.publicKey !== "string" || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(s.publicKey.trim()))) return null;
    const url = new URL(s.registrationURL);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== a.host.toLowerCase() || url.username || url.password || url.port) return null;
    return o;
  } catch { return null; }
}

export function machineError(output: string): string {
  try {
    const o = JSON.parse(output) as { error?: { message?: string } | string; message?: string };
    return typeof o.error === "string" ? o.error : o.error?.message ?? o.message ?? output;
  } catch { return output; }
}

export function parseDoctor(output: string): GitchDoctor | null {
  try {
    const o = JSON.parse(output) as { problems: number; items: GitchDoctor["checks"] };
    if (!Number.isFinite(o.problems) || !Array.isArray(o.items)) return null;
    return { problems: o.problems, checks: o.items.filter((c) => c && typeof c.section === "string" && typeof c.level === "string" && typeof c.message === "string") };
  } catch { return null; }
}
