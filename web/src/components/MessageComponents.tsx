import type { ComponentRow, BotButton, BotSelect } from "../types";

interface Props {
  rows: ComponentRow[];
  messageId: string;
  hubUrl: string;
  onInteract: (messageId: string, customId: string, values: string[]) => void;
}

export function MessageComponents({ rows, messageId, onInteract }: Props) {
  if (!rows.length) return null;
  return (
    <div className="message-components">
      {rows.map((row, ri) => (
        <div key={ri} className="component-row">
          {row.components.map((c, ci) => {
            if (c.type === "button") {
              const btn = c as BotButton;
              return (
                <button
                  key={ci}
                  className={`component-btn component-btn--${btn.style ?? "secondary"}`}
                  disabled={btn.disabled}
                  onClick={() => onInteract(messageId, btn.custom_id, [])}
                >
                  {btn.label}
                </button>
              );
            }
            if (c.type === "select") {
              const sel = c as BotSelect;
              return (
                <select
                  key={ci}
                  className="component-select"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onInteract(messageId, sel.custom_id, [e.target.value]);
                  }}
                >
                  <option value="" disabled>{sel.placeholder ?? "Select…"}</option>
                  {sel.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              );
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
