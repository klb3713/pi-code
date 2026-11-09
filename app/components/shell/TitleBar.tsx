// Custom window title bar, Claude Code desktop style.
import { Text, View } from "nsh";
import { titleBar } from "nsh/desktop";
import { connection, model, runMode, sessionTitle, sidebarOpen, workspace } from "../../store";
import { basename } from "../../lib/format";
import { Glyph, IconButton, StatusDot } from "../common/ui";

export function TitleBar() {
  return (
    <View
      class="flex-row items-center gap-2 border-b border-border bg-background pr-3"
      style={{ height: 44, paddingLeft: titleBar().left + 12 }}
      desktop={{ windowDrag: true }}
    >
      {!sidebarOpen() ? (
        <IconButton symbol="☰" label="展开侧边栏" onPress={() => sidebarOpen.set(true)} size={24} class="mr-1" />
      ) : null}
      <View class="flex-row items-center gap-2">
        <Text class="text-[12px] font-medium text-foreground">{basename(workspace()) || "Pi Code"}</Text>
        {sessionTitle() ? (
          <Text class="max-w-[320px] truncate text-[11px] text-muted-foreground">/ {sessionTitle()}</Text>
        ) : null}
      </View>
      <View class="flex-1" />
      <View class="flex-row items-center gap-1.5">
        <View class="flex-row items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5">
          <StatusDot tone={connection() === "connected" ? "success" : connection() === "connecting" ? "warning" : "error"} />
          <Text class="text-[10px] text-muted-foreground">
            {connection() === "connected" ? "pi 已连接" : connection() === "connecting" ? "连接中" : "未连接"}
          </Text>
        </View>
        <View class="flex-row items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5">
          <Glyph symbol="⎇" size={10} />
          <Text class="text-[10px] text-muted-foreground">{runMode() === "demo" ? "Demo" : "Live"}</Text>
        </View>
        <Text class="max-w-[160px] truncate text-[10px] text-muted-foreground">{model()?.name ?? "未选择模型"}</Text>
      </View>
    </View>
  );
}
