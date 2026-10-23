import icon from "@/shared/assets/icon.png";

/**
 * Shown while a repository opens: the app icon breathes slowly while its newest commit glows.
 * The macOS app draws the same picture (Views/Shared/LoadingView.swift).
 */
export function LoadingView({ title, step, hidden }: { title: string; step: string; hidden?: boolean }) {
  return (
    <div className={`loading ${hidden ? "hide" : ""}`}>
      <GitrochiMark />
      <div style={{ textAlign: "center" }}>
        <div className="title">{title}</div>
        <div className="step">{step}</div>
      </div>
    </div>
  );
}

/** The icon with a blue glow behind it and a green glow over its newest commit (styles.css `.loading .mark`) */
function GitrochiMark() {
  return (
    <div className="mark">
      <img src={icon} alt="" />
      <span />
    </div>
  );
}
