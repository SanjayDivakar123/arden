import fs from 'fs';
import path from 'path';

export class Memory {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
    this.ensureWorkspace();
  }

  private ensureWorkspace() {
    const dirs = ['', 'logs'];
    for (const d of dirs) {
      const p = path.join(this.workspacePath, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
    const files = ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'HEARTBEAT.md'];
    for (const f of files) {
      const p = path.join(this.workspacePath, f);
      if (!fs.existsSync(p)) fs.writeFileSync(p, `# ${f.replace('.md', '')}\n\n`);
    }
  }

  read(file: string): string {
    const p = path.join(this.workspacePath, file);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }

  append(file: string, content: string) {
    const p = path.join(this.workspacePath, file);
    fs.appendFileSync(p, '\n' + content);
  }

  todayLog(): string {
    const date = new Date().toISOString().split('T')[0];
    return this.read(`logs/${date}.md`);
  }

  logToday(entry: string) {
    const date = new Date().toISOString().split('T')[0];
    const ts = new Date().toLocaleTimeString();
    this.append(`logs/${date}.md`, `[${ts}] ${entry}`);
  }

  buildSystemPrompt(agentName: string): string {
    const soul = this.read('SOUL.md');
    const agents = this.read('AGENTS.md');
    const memory = this.read('MEMORY.md');
    const todayLog = this.todayLog();

    return [
      soul,
      agents,
      memory ? `# Long-term Memory\n${memory}` : '',
      todayLog ? `# Today's Log\n${todayLog}` : '',
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }
}
