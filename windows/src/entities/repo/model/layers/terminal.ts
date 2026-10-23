

import { TerminalSession, type TerminalSpec } from "@/entities/terminal";
import { RepoAI } from "./ai";

/** 아래 터미널 패널 */
export abstract class RepoTerminal extends RepoAI {
  get activeTerminal(): TerminalSession | null {
    return this.terminals.find((t) => t.id === this.activeTerminalID) ?? this.terminals[this.terminals.length - 1] ?? null;
  }

  /** Ctrl+` : 터미널 패널 보이기/숨기기(처음이면 저장소 폴더에서 셸을 하나 연다) */
  toggleTerminal() {
    if (this.showTerminal) this.showTerminal = false;
    else if (!this.terminals.length) this.newTerminal();
    else this.showTerminal = true;
    this.emit();
  }

  newTerminal(path?: string, spec: Partial<TerminalSpec> = {}): TerminalSession {
    const dir = path ?? this.path ?? "";
    const s = new TerminalSession({ ...spec, directory: dir });
    s.subscribe(() => this.emit());
    this.terminals = [...this.terminals, s];
    this.activeTerminalID = s.id;
    this.showTerminal = true;
    this.emit();
    return s;
  }

  selectTerminal(s: TerminalSession) {
    this.activeTerminalID = s.id;
    s.unseenOutput = false;
    this.emit();
  }

  focusTerminal(s: TerminalSession) {
    this.activateTab?.();
    this.showTerminal = true;
    this.selectTerminal(s);
    setTimeout(() => s.focus(), 50);
  }

  closeTerminal(s: TerminalSession) {
    s.dispose();
    this.terminals = this.terminals.filter((t) => t !== s);
    if (this.activeTerminalID === s.id) this.activeTerminalID = this.terminals[this.terminals.length - 1]?.id ?? null;
    if (!this.terminals.length) this.showTerminal = false;
    this.emit();
  }

  closeAllTerminals() {
    for (const t of this.terminals) t.dispose();
    this.terminals = [];
    this.activeTerminalID = null;
    this.showTerminal = false;
  }
}
