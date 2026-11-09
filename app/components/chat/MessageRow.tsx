// One message row: user bubble, assistant markdown reply, or centered system note.
import { Text, View } from "nsh";
import { TextView } from "nsh/base";
import type { ToolCallInfo, UiContent } from "../../protocol";
import { formatClock } from "../../lib/format";
import { BrandMark, Spinner, Tag } from "../common/ui";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";

export interface MessageRowProps {
  role: "user" | "assistant" | "system";
  content: UiContent[];
  timestamp?: number;
  error?: string;
  streaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

function textContent(content: UiContent[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

function lastTextIndex(content: UiContent[]): number {
  let result = -1;
  content.forEach((block, index) => {
    if (block.type === "text") result = index;
  });
  return result;
}

function UserRow(props: { content: UiContent[] }) {
  return (
    <View class="w-full flex-row justify-end">
      <View class="max-w-[78%] rounded-2xl bg-secondary px-4 py-2.5">
        <Text class="text-[13px] text-secondary-foreground" style={{ lineHeight: 21 }}>
          {textContent(props.content)}
        </Text>
      </View>
    </View>
  );
}

function AssistantBlocks(props: { content: UiContent[]; streaming?: boolean }) {
  return (
    <Each of={props.content} key="index">
      {(block, index) => {
        const kind = block().type;
        if (kind === "thinking") {
          return (
            <ThinkingBlock
              text={(block() as { type: "thinking"; text: string }).text}
              streaming={props.streaming}
            />
          );
        }
        if (kind === "toolCall") {
          const call = block() as {
            type: "toolCall";
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          };
          return <ToolCard id={call.id} name={call.name} args={call.arguments} />;
        }
        return (
          <TextView
            markdown={(block() as { type: "text"; text: string }).text}
            options={props.streaming ? { streaming: true } : undefined}
            streamingCaret={props.streaming && index() === lastTextIndex(props.content) ? <Text class="text-primary">▍</Text> : undefined}
            codeBlockActions={[{ id: "copy" }]}
            selectable
            class="text-[13px] text-foreground"
            styles={{ root: { fontSize: 13, lineHeight: 21 }, codeBlockCode: { fontSize: 11.5, lineHeight: 17 } }}
            classes={{ codeBlock: "rounded-md border border-border bg-code" }}
          />
        );
      }}
    </Each>
  );
}

function AssistantRow(props: MessageRowProps) {
  return (
    <View class="w-full flex-col gap-2">
      <View class="flex-row items-center gap-2">
        <BrandMark size={22} />
        <Text class="text-[12px] font-semibold text-foreground">Pi Code</Text>
        <Text class="text-[10px] text-muted-foreground">{formatClock(props.timestamp ?? Date.now())}</Text>
        {props.streaming ? <Tag text="生成中" tone="primary" /> : null}
      </View>
      <View class="flex-col gap-2.5" style={{ paddingLeft: 30 }}>
        <AssistantBlocks content={props.content} streaming={props.streaming} />
        <If when={props.toolCalls && props.toolCalls.length > 0}>
          <View class="flex-col gap-2">
            <Each of={props.toolCalls ?? []} key={(call) => call.id}>
              {(call) => <ToolCard id={call().id} name={call().name} args={call().arguments} />}
            </Each>
          </View>
        </If>
        <If
          when={
            props.streaming &&
            props.content.length === 0 &&
            (props.toolCalls === undefined || props.toolCalls.length === 0)
          }
        >
          <View class="flex-row items-center gap-2 py-1">
            <Spinner size={11} />
            <Text class="text-[11px] text-muted-foreground">正在思考…</Text>
          </View>
        </If>
        {props.error ? (
          <View class="rounded-lg border border-destructive bg-card px-3 py-2">
            <Text class="text-[11px] text-destructive">{props.error}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SystemRow(props: { content: UiContent[] }) {
  return (
    <View class="w-full items-center py-0.5">
      <Text class="text-center text-[10.5px] text-muted-foreground" style={{ lineHeight: 16 }}>
        {textContent(props.content)}
      </Text>
    </View>
  );
}

export function MessageRow(props: MessageRowProps) {
  return (
    <View class="w-full flex-col">
      <If when={props.role === "system"}>
        <SystemRow content={props.content} />
      </If>
      <If when={props.role === "user"}>
        <UserRow content={props.content} />
      </If>
      <If when={props.role === "assistant"}>
        <AssistantRow
          role={props.role}
          content={props.content}
          timestamp={props.timestamp}
          error={props.error}
          streaming={props.streaming}
          toolCalls={props.toolCalls}
        />
      </If>
    </View>
  );
}
