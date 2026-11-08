// Bottom composer: multiline prompt input, model/thinking chips and send/stop.
import { computed, signal, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import { actions, busy, connection, model, settingsOpen, thinking } from "../../store";
import { Glyph } from "../common/ui";

export function Composer() {
  const draft = signal("");
  const connected = computed(() => connection() === "connected");
  const canSend = computed(() => draft().trim().length > 0 && connected() && !busy());

  function submit(text: string): void {
    const message = text.trim();
    if (!message || busy() || !connected()) return;
    draft.set("");
    void actions.send(message);
  }

  return (
    <View class="px-6 pb-4 pt-2">
      <View
        class="w-full flex-col self-center rounded-xl border border-border bg-card shadow-lg focus-within:border-primary"
        style={{ maxWidth: 860 }}
      >
        <Input
          multiline
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          onSubmit={({ text }) => submit(text)}
          submitBehavior="submit"
          placeholder="给 Pi Code 一个小任务…"
          scrollbar={false}
          class="w-full px-4 pt-3 text-[13px] text-foreground"
          style={{ minHeight: 72, maxHeight: 200, fontSize: 13, lineHeight: 21 }}
        />
        <View class="flex-row items-center gap-1.5 px-2.5 pb-2 pt-1">
          <Button
            onPress={() => settingsOpen.set(true)}
            class="flex-row items-center gap-1 rounded-full border border-border bg-[#181816] px-2 py-1 transition-colors hover:bg-accent active:bg-accent"
          >
            <Glyph symbol="◌" size={9} />
            <Text class="text-[10px] text-muted-foreground">{model()?.name ?? "选择模型"}</Text>
          </Button>
          <Button
            onPress={() => settingsOpen.set(true)}
            class="flex-row items-center gap-1 rounded-full border border-border bg-[#181816] px-2 py-1 transition-colors hover:bg-accent active:bg-accent"
          >
            <Glyph symbol="⚙" size={9} />
            <Text class="text-[10px] text-muted-foreground">thinking {thinking()}</Text>
          </Button>
          <View class="flex-1" />
          {busy() ? (
            <Button
              onPress={() => void actions.stop()}
              accessibilityLabel="停止生成"
              class="h-8 w-8 items-center justify-center rounded-full border border-border bg-[#181816] transition-colors hover:bg-accent active:bg-accent"
            >
              <Glyph symbol="■" size={10} class="text-destructive" />
            </Button>
          ) : (
            <Button
              onPress={() => submit(draft())}
              disabled={!canSend()}
              accessibilityLabel="发送"
              class={`h-8 w-8 items-center justify-center rounded-full transition-colors ${
                canSend() ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              <Glyph symbol="↑" size={14} class={canSend() ? "text-primary-foreground" : "text-muted-foreground"} />
            </Button>
          )}
        </View>
      </View>
      <Text class="mt-1.5 text-center text-[10px] text-muted-foreground">
        {connected() ? "Enter 发送 · Shift+Enter 换行 · ⌘N 新会话" : "正在连接 pi…"}
      </Text>
    </View>
  );
}
