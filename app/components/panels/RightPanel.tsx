// 右侧面板：文件 / 变更两个标签页，预览时在面板内切换视图。
import { Text, View } from "nsh";
import { Tab, Tabs } from "nsh/base";
import { actions, activeDiff, activeFile, rightPanel, rightPanelOpen, workspace } from "../../store";
import { IconButton } from "../common/ui";
import { ChangesPanel } from "./ChangesPanel";
import { DiffPreview } from "./DiffPreview";
import { FilePreview } from "./FilePreview";
import { FilesPanel } from "./FilesPanel";

export { SettingsDialog } from "./SettingsDialog";

export function RightPanel() {
  return (
    <View class="flex-col border-l border-border bg-sidebar" style={{ width: 320, minWidth: 320 }}>
      <View class="flex-row items-center gap-1 border-b border-border px-2" style={{ height: 40 }}>
        <Tabs class="h-full flex-row items-center gap-1" indicatorClass="bottom-0 h-[2px] bg-primary">
          <Tab
            selected={rightPanel() === "files"}
            onPress={() => {
              rightPanel.set("files");
              activeDiff.set(null);
            }}
            class="h-full items-center justify-center px-2"
          >
            <Text class={`text-[12px] ${rightPanel() === "files" ? "font-medium text-primary" : "text-muted-foreground"}`}>
              文件
            </Text>
          </Tab>
          <Tab
            selected={rightPanel() === "changes"}
            onPress={() => {
              rightPanel.set("changes");
              activeFile.set(null);
            }}
            class="h-full items-center justify-center px-2"
          >
            <Text class={`text-[12px] ${rightPanel() === "changes" ? "font-medium text-primary" : "text-muted-foreground"}`}>
              变更
            </Text>
          </Tab>
        </Tabs>
        <View class="flex-1" />
        <IconButton
          symbol="↻"
          label="刷新"
          onPress={() => void (rightPanel() === "files" ? actions.refreshFiles() : actions.refreshGit())}
          size={24}
        />
        <IconButton symbol="✕" label="关闭右侧面板" onPress={() => rightPanelOpen.set(false)} size={24} />
      </View>

      <View class="flex-1 flex-col" style={{ minHeight: 0 }}>
        {activeFile() ? (
          <FilePreview />
        ) : activeDiff() ? (
          <DiffPreview />
        ) : rightPanel() === "files" ? (
          <FilesPanel />
        ) : (
          <ChangesPanel />
        )}
      </View>

      <View class="flex-row items-center gap-1 border-t border-border px-2.5 py-1">
        <Text class="text-[9px] text-muted-foreground">工作区</Text>
        <Text class="flex-1 truncate text-[9px] text-muted-foreground">{workspace()}</Text>
      </View>
    </View>
  );
}
