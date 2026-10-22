import { type ReactNode } from "react";
import { Button, Modal } from "../shared/ui";

export function Frame({
  title,
  confirm,
  canConfirm,
  onConfirm,
  close,
  width = 500,
  children,
  leftFooter,
}: {
  title: string;
  confirm: string;
  canConfirm: boolean;
  onConfirm: () => void;
  close: () => void;
  width?: number;
  children: ReactNode;
  leftFooter?: ReactNode;
}) {
  const submit = () => {
    if (!canConfirm) return;
    close();
    onConfirm();
  };
  return (
    <Modal
      title={title}
      width={width}
      onClose={close}
      footer={
        <>
          {leftFooter && <span className="hint grow">{leftFooter}</span>}
          <Button onClick={close}>취소</Button>
          <Button kind="primary" disabled={!canConfirm} onClick={submit}>
            {confirm}
          </Button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-row">
      <label>{label}</label>
      <div className="row">{children}</div>
    </div>
  );
}
