// Bottom status strip: connection, model, context usage, workspace.
import { Text, View } from "nsh";
import { busy, connection, git, model, piVersion, runMode, thinking, usage, workspace } from "../../store";
import { formatCost, formatTokens, shortPath } from "../../lib/format";
import { Spinner, StatusDot } from "../common/ui";

export function StatusBar() {
  const tone = connection() === "connected" ? "success" : connection() === "connecting" ? "warning" : "error";
  return (
    <View
      class="flex-row items-center gap-3 border-t border-border bg-sidebar px-3"
      style={{ height: 28 }}
    >
      <View class="flex-row items-center gap-1.5">
        <StatusDot tone={tone} />
        <Text class="text-[10px] text-muted-foreground">
          {connection() === "connected" ? `pi ${piVersion() || ""}` : connection() === "connecting" ? "正在连接 pi…" : "pi 未连接"}
        </Text>
      </View>
      {busy() ? (
        <View class="flex-row items-center gap-1">
          <Spinner size={10} />
          <Text class="text-[10px] text-primary">生成中</Text>
        </View>
      ) : null}
      <View class="h-3 w-px bg-border" />
      <Text class="truncate text-[10px] text-muted-foreground" style={{ maxWidth: 420 }}>
        {shortPath(workspace(), 64)}
      </Text>
      <View class="flex-1" />
      {git().branch ? (
        <View class="flex-row items-center gap-1">
          <Text class="text-[10px] text-muted-foreground">⎇ {git().branch}</Text>
        </View>
      ) : null}
      <Text class="text-[10px] text-muted-foreground">thinking {thinking()}</Text>
      <Text class="text-[10px] text-muted-foreground">{model()?.name ?? "no model"}</Text>
      <Text class="text-[10px] text-muted-foreground">{formatTokens(usage().totalTokens)} tokens</Text>
      <Text class="text-[10px] text-muted-foreground">{formatCost(usage().cost.total)}</Text>
      <View class="rounded-full border border-border px-1.5 py-0.5">
        <Text class="text-[9px] uppercase tracking-wider text-muted-foreground">{runMode() === "demo" ? "demo" : "live"}</Text>
      </View>
    </View>
  );
}
