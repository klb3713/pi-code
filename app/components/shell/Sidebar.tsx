// Left rail: brand, new session, recent sessions, workspace summary.
import { computed, Text, View } from "nsh";
import type { SessionInfo } from "../../protocol";
import { Button } from "nsh/base";
import {
  actions,
  busy,
  model,
  phase,
  sessions,
  settingsOpen,
  sidebarOpen,
  workspace,
} from "../../store";
import { basename, formatClock, todayLabel, truncate } from "../../lib/format";
import { BrandMark, Glyph, IconButton, SectionLabel, StatusDot } from "../common/ui";

const grouped = computed<{ label: string; items: SessionInfo[] }[]>(() => {
  const order = ["今天", "昨天", "最近 7 天", "更早"];
  const map: Record<string, SessionInfo[]> = {};
  for (const label of order) map[label] = [];
  for (const session of sessions()) {
    map[todayLabel(session.updatedAt)].push(session);
  }
  return order.filter((label) => map[label].length > 0).map((label) => ({ label, items: map[label] }));
});

export function Sidebar() {
  return (
    <View class="flex-col border-r border-sidebar-border bg-sidebar" style={{ width: 260 }}>
      <View class="flex-row items-center gap-2 px-3 pt-3 pb-2">
        <BrandMark size={24} />
        <Text class="flex-1 text-[13px] font-semibold text-sidebar-foreground">Pi Code</Text>
        <IconButton
          symbol="◂"
          label="收起侧边栏"
          onPress={() => sidebarOpen.set(false)}
          size={24}
          class="hover:bg-sidebar-accent"
        />
      </View>

      <View class="px-2.5 pb-2">
        <Button
          onPress={() => void actions.newSession()}
          disabled={phase() !== "ready" || busy()}
          class="w-full flex-row items-center gap-2 rounded-md border border-sidebar-border bg-surface px-2.5 py-2 transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent disabled:opacity-50"
        >
          <Glyph symbol="＋" size={12} class="text-primary" />
          <Text class="text-[12px] font-medium text-sidebar-foreground">新建会话</Text>
          <View class="flex-1" />
          <Text class="font-mono text-[10px] text-muted-foreground">⌘N</Text>
        </Button>
      </View>

      <View class="flex-1 px-2.5">
        <View class="flex-row items-center justify-between px-1 pb-1 pt-2">
          <SectionLabel text="会话" />
          <Text class="text-[10px] text-muted-foreground">{sessions().length}</Text>
        </View>
        <View class="flex-col gap-0.5">
          {grouped().length === 0 ? (
            <View class="px-1 py-3">
              <Text class="text-[11px] text-muted-foreground">还没有历史会话</Text>
              <Text class="mt-0.5 text-[10px] text-muted-foreground">发送第一条消息开始</Text>
            </View>
          ) : null}
          {grouped().map((group) => (
            <View class="flex-col gap-0.5">
              <Text class="px-1 pb-0.5 pt-1.5 text-[10px] font-medium text-muted-foreground">{group.label}</Text>
              {group.items.map((session) => (
                <Button
                  onPress={() => void actions.switchSession(session.path)}
                  class="w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent"
                >
                  <Text class="w-full truncate text-[11.5px] text-sidebar-foreground">
                    {session.name || truncate(session.preview ?? "", 26) || "未命名会话"}
                  </Text>
                  <View class="flex-row items-center gap-1">
                    <Text class="text-[10px] text-muted-foreground">{formatClock(session.updatedAt)}</Text>
                    {session.messageCount ? (
                      <Text class="text-[10px] text-muted-foreground">· {session.messageCount} 条</Text>
                    ) : null}
                  </View>
                </Button>
              ))}
            </View>
          ))}
        </View>
      </View>

      <View class="mx-2.5 mb-2 flex-col gap-1 rounded-lg border border-sidebar-border bg-surface p-2">
        <View class="flex-row items-center gap-1.5">
          <Glyph symbol="▤" size={11} />
          <Text class="flex-1 truncate text-[11px] font-medium text-sidebar-foreground">
            {basename(workspace()) || "未选择工作区"}
          </Text>
          <StatusDot tone={phase() === "ready" ? "success" : phase() === "booting" ? "warning" : "error"} />
        </View>
        <Text class="truncate text-[10px] text-muted-foreground" style={{ lineHeight: 13 }}>
          {workspace() || "在设置中选择工作区"}
        </Text>
        <View class="mt-0.5 flex-row items-center gap-1">
          <Text class="text-[10px] text-muted-foreground">{model()?.name ?? "未选择模型"}</Text>
        </View>
      </View>

      <View class="flex-row items-center gap-1 border-t border-sidebar-border px-2.5 py-2">
        <Button
          onPress={() => settingsOpen.set(true)}
          class="flex-1 flex-row items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent"
        >
          <Glyph symbol="⚙" size={12} />
          <Text class="text-[11px] text-sidebar-foreground">设置</Text>
        </Button>
        <Text class="text-[9px] text-muted-foreground">v0.1</Text>
      </View>
    </View>
  );
}
