// Styles shared by the corner bar (inside a shadow root) and the toolbar popup.

export const APPS_CSS = `
.apps { display: flex; flex-direction: column; gap: 1px; }
.app {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 8px 10px; border-radius: 9px; font-size: 13px; color: inherit;
}
.app:hover, .app:focus-visible { background: var(--mh-hover); }
.app.selected { background: var(--mh-hover); }
.app-icon { width: 18px; height: 18px; display: grid; place-items: center; flex: none; }
.app-icon svg { width: 18px; height: 18px; }
.app-name { flex: 1; }
.app-note { color: var(--mh-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.app-kind { color: var(--mh-muted); display: flex; }
.app-kind svg { width: 14px; height: 14px; }
.app.more { color: var(--mh-muted); }
.app.more > svg { width: 14px; height: 14px; margin: 0 2px; }
.divider { height: 1px; background: var(--mh-border); margin: 4px 6px; }

.toast {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box;
  background: #111827; color: #fff; border-radius: 14px; padding: 10px 12px; font-size: 13px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); max-width: 380px;
}
.toast-body { min-width: 0; }
.toast-code {
  display: block; margin-top: 2px; color: #9ca3af; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.toast-check { width: 20px; height: 20px; border-radius: 50%; background: #22c55e; display: grid; place-items: center; flex: none; }
.toast-check svg { width: 12px; height: 12px; color: #fff; }
`;

export const BAR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
.wrap {
  --mh-hover: #f3f4f6; --mh-muted: #9ca3af; --mh-border: #f0f0f0;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  line-height: 1.4; -webkit-font-smoothing: antialiased;
}
button { font: inherit; }
.bar {
  display: flex; align-items: center; gap: 10px; background: #111827; color: #fff;
  border-radius: 14px; padding: 8px 8px 8px 12px; font-size: 13px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(255 255 255 / 0.06);
}
.lead { display: flex; align-items: center; gap: 8px; color: #d1d5db; white-space: nowrap; }
.lead b { color: #fff; font-weight: 600; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgb(34 197 94 / 0.2); flex: none; }
.split { display: flex; border-radius: 9px; overflow: hidden; }
.split button {
  all: unset; cursor: pointer; background: #fff; color: #111827; font-size: 13px; font-weight: 600;
  padding: 7px 10px; display: flex; align-items: center; gap: 7px; white-space: nowrap;
}
.split button:hover, .split button:focus-visible { background: #f3f4f6; }
.split .caret { border-left: 1px solid #e5e7eb; padding: 7px 8px; }
.split .caret svg { width: 14px; height: 14px; }
.close { all: unset; cursor: pointer; color: #6b7280; padding: 4px; display: flex; border-radius: 6px; }
.close:hover, .close:focus-visible { color: #fff; }
.close svg { width: 14px; height: 14px; }
.menu {
  width: 300px; max-height: calc(100vh - 110px); overflow-y: auto;
  background: #fff; color: #111827; border-radius: 14px; padding: 6px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.22), 0 0 0 1px rgb(0 0 0 / 0.06);
}
.menu-head { padding: 8px 10px 6px; color: #6b7280; font-size: 12px; }
.servers { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 6px 6px; }
.servers button { all: unset; cursor: pointer; font-size: 12px; padding: 3px 8px; border-radius: 999px; background: #f3f4f6; color: #374151; }
.servers button[aria-pressed='true'] { background: #111827; color: #fff; }
.tab {
  all: unset; cursor: pointer; position: relative; display: grid; place-items: center;
  width: 40px; height: 40px; border-radius: 12px; background: #111827; color: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
}
.tab svg { width: 18px; height: 18px; }
.tab .dot { position: absolute; top: 6px; right: 6px; }
${APPS_CSS}
`;
