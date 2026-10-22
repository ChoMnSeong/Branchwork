import { useState } from "react";
import { Button, Modal, Segmented } from "../shared/ui";
import { AISettings } from "./AISettings";
import { AboutSettings } from "./AboutSettings";
import { AccountsSettings } from "./AccountsSettings";
import { RulesSettings } from "./RulesSettings";
import { ToolsSettings } from "./ToolsSettings";

/** Ctrl+, 설정: 계정(GitHub·GitLab), AI, 도구(실행 파일 위치) */
export function SettingsDialog({ onClose, initialTab = "accounts" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <Modal title="설정" width={640} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "accounts", label: "계정" },
          { value: "ai", label: "AI" },
          { value: "rules", label: "규칙" },
          { value: "tools", label: "도구" },
          { value: "about", label: "업데이트" },
        ]}
      />
      <div style={{ minHeight: 420 }}>
        {tab === "accounts" ? (
          <AccountsSettings />
        ) : tab === "ai" ? (
          <AISettings />
        ) : tab === "rules" ? (
          <RulesSettings />
        ) : tab === "tools" ? (
          <ToolsSettings />
        ) : (
          <AboutSettings />
        )}
      </div>
    </Modal>
  );
}

export type SettingsTab = "accounts" | "ai" | "rules" | "tools" | "about";
