// 差异预览：优先展示 unified patch，否则用旧/新文本交给 DiffView 对比。
import { computed, signal, Text, View } from "nsh";
import { DiffView, type DiffStats } from "nsh/base";
import { activeDiff, countPatch } from "../../store";
import { languageFromPath } from "../../lib/format";
import { EmptyHint, IconButton } from "../common/ui";

export function DiffPreview() {
  const liveStats = signal<DiffStats | null>(null);

  const stats = computed(() => {
    const patchStats = countPatch(activeDiff()?.patch);
    if (patchStats) return patchStats;
    const live = liveStats();
    return { additions: live?.added ?? 0, deletions: live?.deleted ?? 0 };
  });

  const hasContent = computed(() => {
    const diff = activeDiff();
    if (!diff) return false;
    return Boolean(diff.patch) || diff.oldText !== undefined || diff.newText !== undefined;
  });

  return (
    <View class="flex-1 flex-col" style={{ minHeight: 0 }}>
      <View class="flex-row items-center gap-1 border-b border-border px-1.5 py-1">
        <IconButton symbol="←" label="返回变更列表" onPress={() => activeDiff.set(null)} size={24} />
        <Text class="flex-1 truncate text-[11px] font-medium text-sidebar-foreground" style={{ minWidth: 0 }}>
          {activeDiff()?.path ?? ""}
        </Text>
        <Text class="font-mono text-[10px] text-green-400">+{stats().additions}</Text>
        <Text class="font-mono text-[10px] text-destructive">−{stats().deletions}</Text>
        <IconButton symbol="✕" label="关闭差异预览" onPress={() => activeDiff.set(null)} size={24} />
      </View>

      {activeDiff() === null ? (
        <EmptyHint title="未打开差异" detail="从变更列表中选择一个文件" icon="±" />
      ) : activeDiff()?.isBinary ? (
        <EmptyHint title="二进制文件" detail="无法预览差异" icon="±" />
      ) : !hasContent() ? (
        <EmptyHint title="没有差异" detail="这个文件与工作区一致" icon="±" />
      ) : (
        <DiffView
          class="flex-1"
          style={{ minHeight: 0 }}
          patch={activeDiff()?.patch ?? null}
          oldValue={activeDiff()?.patch ? null : (activeDiff()?.oldText ?? null)}
          newValue={activeDiff()?.patch ? null : (activeDiff()?.newText ?? null)}
          language={activeDiff()?.language ?? languageFromPath(activeDiff()?.path ?? "")}
          layout="unified"
          fontSize={12}
          lineHeight={18}
          background={true}
          lineNumbers={true}
          onStatsChange={({ stats: next }) => liveStats.set(next)}
        />
      )}
    </View>
  );
}
