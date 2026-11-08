// 变更面板：本次会话改动 + git 变更，点击查看 Diff。
import { computed, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { actions, changedFiles, git } from "../../store";
import { basename, dirname, statusColor, statusLetter } from "../../lib/format";
import { EmptyHint } from "../common/ui";

export function ChangesPanel() {
  const total = computed(() => changedFiles().length);

  return (
    <View class="flex-1 flex-col" style={{ minHeight: 0 }}>
      <View class="flex-row items-center gap-2 border-b border-border px-2.5 py-1.5">
        <Text class="text-[10px] font-medium text-muted-foreground">本次会话 / git 变更</Text>
        <View class="flex-1" />
        {git().branch ? <Text class="text-[10px] text-muted-foreground">⎇ {git().branch}</Text> : null}
        <Text class="font-mono text-[10px] text-muted-foreground">{total()}</Text>
      </View>

      {changedFiles().length === 0 ? (
        <EmptyHint title="还没有变更 · 让 pi 改点东西吧" icon="±" />
      ) : (
        <Scroll class="flex-1">
          <View class="flex-col gap-0.5 p-1.5">
            <Each of={changedFiles()} key={(item) => item.path}>
              {(item) => (
                <Button
                  onPress={() => void actions.openDiff(item().path)}
                  class="w-full flex-row items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent"
                >
                  <Text class={`w-3 text-center font-mono text-[11px] font-semibold ${statusColor(item().status)}`}>
                    {statusLetter(item().status)}
                  </Text>
                  <View class="flex-1 flex-col" style={{ minWidth: 0 }}>
                    <Text class="truncate text-[12px] text-sidebar-foreground">{basename(item().path)}</Text>
                    <Text class="truncate text-[10px] text-muted-foreground">{dirname(item().path) || "./"}</Text>
                  </View>
                  {item().additions !== undefined || item().deletions !== undefined ? (
                    <View class="flex-row items-center gap-1.5">
                      <Text class="font-mono text-[10px] text-green-400">+{item().additions ?? 0}</Text>
                      <Text class="font-mono text-[10px] text-destructive">−{item().deletions ?? 0}</Text>
                    </View>
                  ) : null}
                </Button>
              )}
            </Each>
          </View>
        </Scroll>
      )}
    </View>
  );
}
