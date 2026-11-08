// 工作区文件树面板：目录展开、文件选中、双击/回车打开预览。
import { computed, effect, signal, Text, View } from "nsh";
import { Tree, type TreeItem } from "nsh/base";
import type { FileNode } from "../../protocol";
import { actions, activeFile, files, phase } from "../../store";
import { fileBadge } from "../../lib/format";
import { EmptyHint, IconButton, Spinner } from "../common/ui";

function toTreeItems(nodes: FileNode[]): TreeItem[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.name,
    children:
      node.kind === "dir" && node.children && node.children.length > 0 ? toTreeItems(node.children) : undefined,
  }));
}

function countFiles(nodes: FileNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === "file") {
      total += 1;
    } else if (node.children) {
      total += countFiles(node.children);
    }
  }
  return total;
}

function collectNodes(nodes: FileNode[], map: Map<string, FileNode>): void {
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.children) collectNodes(node.children, map);
  }
}

export function FilesPanel() {
  const expanded = signal<string[]>([]);
  const selected = signal<string | null>(null);
  let initialized = false;

  // 首次拿到文件列表时，默认展开根级目录。
  effect(() => {
    const list = files();
    if (initialized || list.length === 0) return;
    initialized = true;
    expanded.set(list.filter((node) => node.kind === "dir").map((node) => node.id));
  });

  // 外部（打开文件 / 关闭预览）改变 activeFile 时同步选中项。
  effect(() => {
    const file = activeFile();
    if (file) selected.set(file.path);
  });

  const items = computed(() => toTreeItems(files()));
  const nodesById = computed(() => {
    const map = new Map<string, FileNode>();
    collectNodes(files(), map);
    return map;
  });
  const total = computed(() => countFiles(files()));

  return (
    <View class="flex-1 flex-col" style={{ minHeight: 0 }}>
      <View class="flex-row items-center gap-2 border-b border-border px-2 py-1">
        <IconButton
          symbol="↻"
          label="刷新文件列表"
          onPress={() => void actions.refreshFiles()}
          size={22}
        />
        <Text class="text-[10px] text-muted-foreground">{total()} 个文件</Text>
        <View class="flex-1" />
        {phase() === "booting" ? <Spinner size={10} /> : null}
      </View>

      {items().length === 0 ? (
        <EmptyHint title="工作区还没有文件" detail="让 pi 创建一个文件，或点击刷新" icon="▤" />
      ) : (
        <Tree
          class="flex-1"
          style={{ minHeight: 0 }}
          items={items()}
          expanded={expanded()}
          selected={selected()}
          accessibilityLabel="工作区文件"
          listClass="py-1"
          itemClass="group mx-1.5 rounded-md px-1.5 hover:bg-sidebar-accent active:bg-sidebar-accent selected:bg-sidebar-accent"
          onExpandedChange={({ expanded: next }) => expanded.set(next)}
          onSelectedChange={({ selected: next }) => {
            selected.set(next);
            const node = nodesById().get(next);
            if (node && node.kind === "file") void actions.openFile(next);
          }}
          onAction={({ id }) => {
            const node = nodesById().get(id);
            if (node && node.kind === "file") void actions.openFile(id);
          }}
          renderItem={(entry) => {
            const badge = entry.folder ? null : fileBadge(entry.id);
            const node = nodesById().get(entry.id);
            return (
              <View class="h-7 flex-row items-center gap-1.5" style={{ paddingLeft: entry.depth * 12 }}>
                {entry.folder ? (
                  <Text class="w-3 text-[10px] text-muted-foreground transition-transform group-aria-expanded:rotate-90">▸</Text>
                ) : (
                  <Text
                    class={`w-[18px] text-center font-mono text-[9px] ${badge ? badge.className : "text-muted-foreground"}`}
                    style={{ lineHeight: 14 }}
                  >
                    {badge ? badge.text : "·"}
                  </Text>
                )}
                <Text
                  class={`flex-1 truncate text-[12px] text-sidebar-foreground group-selected:text-foreground ${
                    entry.folder ? "font-medium" : ""
                  }`}
                >
                  {entry.label}
                </Text>
                {entry.folder && node?.children && node.children.length > 0 ? (
                  <Text class="text-[9px] text-muted-foreground">{countFiles(node.children)}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
