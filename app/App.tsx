// Root component for Pi Code. The entry App.tsx mounts this.
import { effect, keymap, Text, View } from "nsh";
import { Button } from "nsh/base";
import { isAvailable, Window } from "nsh/desktop";
import {
  actions,
  bootError,
  bootstrap,
  phase,
  reconnect,
  rightPanelOpen,
  settings,
  settingsOpen,
  shutdown,
  sidebarOpen,
  toast,
  workspace,
} from "./store";
import { basename } from "./lib/format";
import { ChatView } from "./components/chat/ChatView";
import { RightPanel, SettingsDialog } from "./components/panels/RightPanel";
import { Sidebar } from "./components/shell/Sidebar";
import { StatusBar } from "./components/shell/StatusBar";
import { TitleBar } from "./components/shell/TitleBar";

let started = false;

function ensureStarted(): void {
  if (started) return;
  started = true;
  if (isAvailable) {
    Window.setTitleBar({ style: "hidden", height: 44 });
    Window.setTitle("Pi Code");
  }
  void bootstrap();
}

function ToastHost() {
  const current = toast();
  if (!current) return null;
  const tone =
    current.tone === "error"
      ? "border-destructive/40 bg-destructive/15 text-destructive"
      : current.tone === "success"
        ? "border-success/40 bg-success/15 text-success"
        : "border-border bg-popover text-popover-foreground";
  return (
    <View class="absolute left-0 right-0 top-14 items-center" style={{ pointerEvents: "none" }}>
      <View class={`rounded-lg border px-3 py-1.5 shadow-lg ${tone}`}>
        <Text class="text-[11px] font-medium">{current.text}</Text>
      </View>
    </View>
  );
}

export function App() {
  ensureStarted();
  effect(() => {
    if (isAvailable) Window.setTitle(`${basename(workspace()) || "Pi Code"} — Pi Code`);
  });
  effect(() => {
    return () => shutdown();
  });
  effect(() => {
    const unbind = keymap.bind({
      "mod+n": () => void actions.newSession(),
      "mod+,": () => settingsOpen.set(true),
      "mod+b": () => sidebarOpen.update((open) => !open),
      "mod+shift+b": () => rightPanelOpen.update((open) => !open),
    });
    return () => {
      unbind();
      if (isAvailable) Window.setTitleBar({ style: "default" });
    };
  });
  return (
    <View class="flex-1 flex-col bg-background text-foreground" style={{ minWidth: 760, minHeight: 520 }}>
      <TitleBar />
      <View class="flex-1 flex-row" style={{ minHeight: 0 }}>
        {sidebarOpen() ? <Sidebar /> : null}
        <View class="flex-1 flex-col" style={{ minWidth: 0 }}>
          {phase() === "error" ? (
            <View class="flex-row items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2">
              <Text class="text-[11px] font-medium text-destructive">连接失败</Text>
              <Text class="flex-1 truncate text-[11px] text-destructive">{bootError() || "无法启动 pi bridge"}</Text>
              <Button
                onPress={() => void reconnect(workspace(), settings().mode)}
                class="rounded-md border border-destructive/40 px-2 py-1 transition-colors hover:bg-destructive/15 active:bg-destructive/20"
              >
                <Text class="text-[10px] text-destructive">重试连接</Text>
              </Button>
              <Button
                onPress={() => settingsOpen.set(true)}
                class="rounded-md border border-destructive/40 px-2 py-1 transition-colors hover:bg-destructive/15 active:bg-destructive/20"
              >
                <Text class="text-[10px] text-destructive">打开设置</Text>
              </Button>
            </View>
          ) : null}
          <ChatView />
        </View>
        {rightPanelOpen() ? <RightPanel /> : null}
      </View>
      <StatusBar />
      <SettingsDialog />
      <ToastHost />
    </View>
  );
}
