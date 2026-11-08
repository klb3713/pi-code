// Tool call card: glyph, label, target, status and collapsible output.
import { computed, signal, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { ToolRun } from "../../store";
import { changedFiles, tools } from "../../store";
import { formatDuration, shortPath, toolLabel, toolTarget } from "../../lib/format";
import { Glyph, Spinner } from "../common/ui";

const TOOL_GLYPHS: Record<string, string> = {
  read: "▤",
  write: "✎",
  edit: "±",
  bash: "⌘",
  ls: "▸",
  grep: "⌕",
  find: "⌖",
};

export interface ToolCardProps {
  id: string;
  name?: string;
  args?: Record<string, unknown>;
}

export function ToolCard(props: ToolCardProps) {
  const expanded = signal<boolean | null>(null);
  const run = computed<ToolRun | undefined>(() => tools()[props.id]);
  const name = computed(() => run()?.name ?? props.name ?? "tool");
  const args = computed(() => run()?.args ?? props.args ?? {});
  const target = computed(() => toolTarget({ name: name(), args: args() }));
  const status = computed(() => run()?.status ?? "done");
  const open = computed(() => expanded() ?? status() === "running");
  const output = computed(() => {
    const text = run()?.output ?? "";
    return text.length > 8000 ? `${text.slice(0, 8000)}\n\n…（输出已截断）` : text;
  });
  const outputHeight = computed(() => {
    const text = output();
    if (!text) return 0;
    const lines = text.split("\n").length;
    return Math.min(260, Math.max(48, lines * 16 + 14));
  });
  const preview = computed(() => {
    if (name() !== "write" && name() !== "edit") return "";
    const values = args();
    const content =
      typeof values.content === "string"
        ? values.content
        : typeof values.newText === "string"
          ? values.newText
          : "";
    if (!content) return "";
    const lines = content.split("\n");
    return `${lines.slice(0, 6).join("\n")}${lines.length > 6 ? "\n…" : ""}`;
  });
  const stats = computed(() => {
    const path = target();
    if (!path) return null;
    const file = changedFiles().find((entry) => entry.path === path);
    if (!file || (file.additions === undefined && file.deletions === undefined)) return null;
    return { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };
  });

  return (
    <View
      class={`w-full flex-col overflow-hidden rounded-lg border bg-card ${
        status() === "error" ? "border-destructive" : "border-border"
      }`}
    >
      <Button
        onPress={() => expanded.set(!open())}
        class="w-full flex-row items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent active:bg-accent"
      >
        <Glyph symbol={TOOL_GLYPHS[name()] ?? "⚙"} size={12} class="text-muted-foreground" />
        <Text class="text-[12px] font-medium text-foreground">{toolLabel(name())}</Text>
        {target() ? (
          <Text class="flex-1 truncate font-mono text-[11px] text-muted-foreground" style={{ maxWidth: 460 }}>
            {shortPath(target(), 64)}
          </Text>
        ) : (
          <View class="flex-1" />
        )}
        {status() === "running" ? (
          <View class="flex-row items-center gap-1">
            <Spinner size={10} />
            <Text class="text-[10px] text-muted-foreground">运行中</Text>
          </View>
        ) : status() === "error" ? (
          <View class="flex-row items-center gap-1">
            <Text class="text-[11px] text-destructive">✕</Text>
            <Text class="text-[10px] text-destructive">失败</Text>
          </View>
        ) : (
          <View class="flex-row items-center gap-1">
            <Text class="text-[11px] text-green-400">✓</Text>
            <Text class="text-[10px] text-muted-foreground">{formatDuration(run()?.durationMs)}</Text>
          </View>
        )}
        <Glyph symbol={open() ? "▾" : "▸"} size={9} />
      </Button>

      <If when={open()}>
        <View class="flex-col gap-2 border-t border-border px-3 py-2">
          <If when={preview().length > 0}>
            <View class="flex-col gap-1 rounded-md bg-[#171714] px-2.5 py-2">
              <Text class="text-[10px] text-muted-foreground">内容预览</Text>
              <Text class="font-mono text-[11px] text-[#d8d4cb]" style={{ lineHeight: 16 }}>
                {preview()}
              </Text>
            </View>
          </If>
          <If when={output().length > 0}>
            <View class="flex-col" style={{ height: outputHeight() }}>
              <Scroll class="flex-1" scrollbar>
                <Text class="font-mono text-[11px] text-foreground" style={{ lineHeight: 16 }}>
                  {output()}
                </Text>
              </Scroll>
            </View>
          </If>
          <If when={output().length === 0 && status() === "running"}>
            <View class="flex-row items-center gap-2">
              <Spinner size={10} />
              <Text class="text-[11px] text-muted-foreground">等待输出…</Text>
            </View>
          </If>
        </View>
      </If>

      <If when={stats()}>
        {(value) => (
          <View class="flex-row items-center gap-2 border-t border-border px-3 py-1.5">
            <Text class="text-[10px] text-muted-foreground">变更</Text>
            <Text class="font-mono text-[10px] text-green-400">+{value().additions}</Text>
            <Text class="font-mono text-[10px] text-destructive">−{value().deletions}</Text>
          </View>
        )}
      </If>
    </View>
  );
}
