// 只读文件预览：标题栏 + 行号 + 等宽文本，最多渲染前 400 行。
import { computed, Scroll, Text, View } from "nsh";
import { activeFile } from "../../store";
import { basename } from "../../lib/format";
import { EmptyHint, IconButton } from "../common/ui";

const MAX_LINES = 400;

export function FilePreview() {
  const allLines = computed(() => {
    const file = activeFile();
    if (!file) return [] as string[];
    return file.content.split("\n");
  });
  const shownLines = computed(() => allLines().slice(0, MAX_LINES));
  const truncated = computed(() => allLines().length > MAX_LINES);

  return (
    <View class="flex-1 flex-col" style={{ minHeight: 0 }}>
      <View class="flex-row items-center gap-1 border-b border-border px-1.5 py-1">
        <IconButton symbol="←" label="返回文件列表" onPress={() => activeFile.set(null)} size={24} />
        <View class="flex-1 flex-col" style={{ minWidth: 0 }}>
          <Text class="truncate text-[12px] font-medium text-sidebar-foreground">
            {basename(activeFile()?.path ?? "") || "文件预览"}
          </Text>
          <Text class="truncate text-[10px] text-muted-foreground">{activeFile()?.path ?? ""}</Text>
        </View>
        <Text class="text-[10px] text-muted-foreground">{allLines().length} 行</Text>
        <IconButton symbol="✕" label="关闭文件预览" onPress={() => activeFile.set(null)} size={24} />
      </View>

      {activeFile() === null ? (
        <EmptyHint title="未打开文件" detail="从文件树中选择一个文件" icon="▤" />
      ) : (
        <Scroll class="flex-1">
          <View class="flex-col py-1">
            <Each of={shownLines()} key="index">
              {(line, index) => (
                <View class="flex-row items-start px-2">
                  <Text
                    class="text-right font-mono text-[11px] text-muted-foreground"
                    style={{ width: 44, paddingRight: 10, lineHeight: 18 }}
                  >
                    {index() + 1}
                  </Text>
                  <Text class="flex-1 font-mono text-[12px] text-foreground" style={{ lineHeight: 18 }}>
                    {line() === "" ? " " : line()}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
      )}

      {truncated() ? (
        <View class="border-t border-border px-2 py-1">
          <Text class="text-[10px] text-amber-400">仅显示前 400 行</Text>
        </View>
      ) : activeFile()?.truncated ? (
        <View class="border-t border-border px-2 py-1">
          <Text class="text-[10px] text-amber-400">文件较大，内容已截断</Text>
        </View>
      ) : null}
    </View>
  );
}
