// 设置对话框：工作区、运行模式、模型与 thinking 级别。
import { computed, Text, View } from "nsh";
import { Button, Dialog, Input, Select, type SelectItem } from "nsh/base";
import type { RunMode, ThinkingLevel } from "../../protocol";
import { actions, bootError, models, settings, settingsError, settingsOpen, settingsSaving } from "../../store";

const MODE_ITEMS: SelectItem[] = [
  { value: "auto", title: "自动" },
  { value: "demo", title: "演示" },
  { value: "real", title: "真实" },
];

const THINKING_ITEMS: SelectItem[] = [
  { value: "off", title: "off" },
  { value: "minimal", title: "minimal" },
  { value: "low", title: "low" },
  { value: "medium", title: "medium" },
  { value: "high", title: "high" },
  { value: "xhigh", title: "xhigh" },
];

function FieldSelect(props: {
  label: string;
  value: string | null;
  title: string;
  items: SelectItem[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View class="flex-col gap-1.5">
      <Text class="text-[11px] font-medium text-card-foreground">{props.label}</Text>
      <Select
        items={props.items}
        value={props.value}
        disabled={props.disabled}
        onChange={({ value }) => {
          if (value !== null) props.onChange(value);
        }}
        accessibilityLabel={props.label}
        offset={4}
        popupClass="rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        itemClass="rounded px-2 py-1.5 text-[12px] text-popover-foreground focus:bg-accent focus:text-accent-foreground selected:font-medium"
        trigger={
          <View class="h-8 flex-row items-center justify-between rounded-md border border-border bg-[#181816] px-2.5 transition-colors hover:bg-accent active:bg-accent disabled:opacity-50">
            <Text class="truncate text-[12px] text-foreground">{props.title}</Text>
            <Text class="text-[10px] text-muted-foreground">▾</Text>
          </View>
        }
      />
    </View>
  );
}

export function SettingsDialog() {
  const modelItems = computed<SelectItem[]>(() =>
    models().map((item) => ({ value: `${item.provider}/${item.id}`, title: item.name })),
  );
  const modelTitle = computed(() => {
    const key = settings().modelKey;
    const found = models().find((item) => `${item.provider}/${item.id}` === key);
    return found?.name ?? (key || "使用默认模型");
  });
  const modeTitle = computed(() => MODE_ITEMS.find((item) => item.value === settings().mode)?.title ?? "自动");
  const thinkingTitle = computed(
    () => THINKING_ITEMS.find((item) => item.value === settings().thinking)?.title ?? settings().thinking,
  );

  return (
    <Dialog
      open={settingsOpen()}
      animation="fade"
      onOpenChange={({ open }) => settingsOpen.set(open)}
      backdropClass="bg-black/50"
      class="m-auto w-[560px] flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-2xl"
    >
      <View class="flex-col gap-0.5">
        <Text class="text-[16px] font-semibold text-card-foreground">设置</Text>
        <Text class="text-[11px] text-muted-foreground">Pi Code · pi agent</Text>
      </View>

      <View class="flex-col gap-1.5">
        <Text class="text-[11px] font-medium text-card-foreground">工作区</Text>
        <Input
          value={settings().workspace}
          onChange={({ value }) => settings.update((current) => ({ ...current, workspace: value }))}
          placeholder="选择或输入工作区路径"
          class="h-8 rounded-md border border-border bg-[#181816] px-2.5 font-mono text-[12px] text-foreground"
        />
      </View>

      <FieldSelect
        label="运行模式"
        value={settings().mode}
        title={modeTitle()}
        items={MODE_ITEMS}
        onChange={(value) => {
          if (value === "auto" || value === "demo" || value === "real") {
            const mode: RunMode = value;
            settings.update((current) => ({ ...current, mode }));
          }
        }}
      />

      <View class="flex-col gap-2 rounded-md border border-border bg-[#181816] p-2.5">
        <View class="flex-col gap-0.5">
          <Text class="text-[12px] font-medium text-card-foreground">自定义 OpenAI 兼容网关</Text>
          <Text class="text-[10px] text-muted-foreground">留空地址则使用 pi 原生 provider；密钥可以留空。</Text>
        </View>
        <View class="flex-col gap-1.5">
          <Text class="text-[11px] font-medium text-card-foreground">Base URL</Text>
          <Input
            value={settings().gateway.baseUrl}
            onChange={({ value }) =>
              settings.update((current) => ({
                ...current,
                modelKey: current.modelKey.startsWith("openai-gateway/") ? "" : current.modelKey,
                gateway: { ...current.gateway, baseUrl: value },
              }))
            }
            placeholder="http://127.0.0.1:3425/v1"
            class="h-8 rounded-md border border-border bg-card px-2.5 font-mono text-[12px] text-foreground"
          />
        </View>
        <View class="flex-col gap-1.5">
          <Text class="text-[11px] font-medium text-card-foreground">API Key</Text>
          <Input
            value={settings().gateway.apiKey}
            onChange={({ value }) =>
              settings.update((current) => ({ ...current, gateway: { ...current.gateway, apiKey: value } }))
            }
            placeholder="网关 API Key（可选）"
            class="h-8 rounded-md border border-border bg-card px-2.5 font-mono text-[12px] text-foreground"
          />
        </View>
      </View>

      <FieldSelect
        label="默认模型"
        value={settings().modelKey || null}
        title={modelTitle()}
        items={modelItems()}
        disabled={modelItems().length === 0}
        onChange={(value) => settings.update((current) => ({ ...current, modelKey: value }))}
      />

      <FieldSelect
        label="Thinking"
        value={settings().thinking}
        title={thinkingTitle()}
        items={THINKING_ITEMS}
        onChange={(value) => {
          const thinking = value as ThinkingLevel;
          settings.update((current) => ({ ...current, thinking }));
        }}
      />

      {settingsError() || bootError() ? (
        <Text class="text-[10px] text-destructive">{settingsError() || bootError()}</Text>
      ) : null}

      <View class="flex-col gap-1 rounded-md border border-border bg-[#181816] p-2.5">
        <Text class="text-[10px] text-muted-foreground">
          自动 / 真实模式下，保存新网关会立即重连并请求 /models；再从「默认模型」选择并保存即可持久化。
        </Text>
        <Text class="text-[10px] text-muted-foreground">
          全部设置保存在 ~/.pi-code/config.json。Demo 使用本地模拟模型，但 pi agent loop 与工具仍真实执行。
        </Text>
      </View>

      <View class="flex-row items-center justify-end gap-2 pt-1">
        <Button
          onPress={() => settingsOpen.set(false)}
          class="rounded-md border border-border bg-[#181816] px-3 py-1.5 transition-colors hover:bg-accent active:bg-accent"
        >
          <Text class="text-[12px] text-foreground">取消</Text>
        </Button>
        <Button
          disabled={settingsSaving()}
          onPress={() => void actions.applySettings()}
          class="rounded-md bg-primary px-3 py-1.5 transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
        >
          <Text class="text-[12px] font-medium text-primary-foreground">{settingsSaving() ? "保存中…" : "保存"}</Text>
        </Button>
      </View>
    </Dialog>
  );
}
