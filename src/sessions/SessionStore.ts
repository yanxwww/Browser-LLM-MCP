import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "../types.js";

export interface SessionRecord {
  provider: ProviderId;
  sessionId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionFile {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

export class SessionStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async get(provider: ProviderId, sessionId: string): Promise<SessionRecord | undefined> {
    const data = await this.read();
    return data.sessions[this.key(provider, sessionId)];
  }

  async upsert(provider: ProviderId, sessionId: string, url: string): Promise<SessionRecord> {
    const run = async () => {
      const data = await this.read();
      const key = this.key(provider, sessionId);
      const now = new Date().toISOString();
      const existing = data.sessions[key];
      const record: SessionRecord = {
        provider,
        sessionId,
        url,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      data.sessions[key] = record;
      await this.write(data);
      return record;
    };

    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
    }
  }

  async remove(provider: ProviderId, sessionId: string): Promise<void> {
    const data = await this.read();
    delete data.sessions[this.key(provider, sessionId)];
    await this.write(data);
  }

  private async read(): Promise<SessionFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionFile;
      return {
        version: 1,
        sessions: parsed.sessions ?? {}
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 1, sessions: {} };
      }

      throw error;
    }
  }

  private async write(data: SessionFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private key(provider: ProviderId, sessionId: string): string {
    return `${provider}:${sessionId}`;
  }
}
