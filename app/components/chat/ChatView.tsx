// Main chat surface: scrolling message transcript plus the composer.
import { computed, effect, Scroll, View, type ScrollRef } from "nsh";
import type { UiContent } from "../../protocol";
import { activeAssistant, messages, tools } from "../../store";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { Welcome } from "./Welcome";

export function ChatView() {
  let scroller: ScrollRef | undefined;

  const empty = computed(() => messages().length === 0 && activeAssistant() === null);
  const activeContent = computed<UiContent[]>(() => {
    const active = activeAssistant();
    if (!active) return [];
    return active.blocks
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((block): UiContent =>
        block.kind === "text"
          ? { type: "text", text: block.text }
          : { type: "thinking", text: block.text },
      );
  });

  effect(() => {
    messages().length;
    activeAssistant();
    tools();
    scroller?.scrollToEnd({ animated: true });
  });

  return (
    <View class="flex-1 flex-col bg-background" style={{ minHeight: 0 }}>
      <Scroll
        ref={(ref) => {
          scroller = ref;
        }}
        class="flex-1"
        scrollbar={false}
        keyboardShouldPersistTaps="handled"
        contentClass="grow items-center px-8 py-6"
      >
        <If
          when={empty()}
          else={
            <View class="w-full flex-col gap-5" style={{ maxWidth: 860 }}>
              <Each of={messages()} key={(message) => message.id}>
                {(message) => (
                  <MessageRow
                    role={message().role}
                    content={message().content}
                    timestamp={message().timestamp}
                    error={message().error}
                  />
                )}
              </Each>
              <If when={activeAssistant()}>
                <MessageRow
                  role="assistant"
                  content={activeContent()}
                  timestamp={activeAssistant()?.startedAt}
                  toolCalls={activeAssistant()?.toolCalls}
                  streaming
                />
              </If>
              <View style={{ height: 12 }} />
            </View>
          }
        >
          <Welcome />
        </If>
      </Scroll>
      <Composer />
    </View>
  );
}
