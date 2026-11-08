// Collapsible thinking block shown above an assistant reply.
import { signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Glyph } from "../common/ui";

export interface ThinkingBlockProps {
  text: string;
  streaming?: boolean;
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const open = signal(false);
  return (
    <View class="flex-col">
      <View class="flex-row">
        <Button
          onPress={() => open.update((value) => !value)}
          class="flex-row items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-accent active:bg-accent"
        >
          <Glyph symbol={open() ? "▾" : "▸"} size={9} />
          <Text class="text-[11px] text-muted-foreground">思考过程</Text>
          {props.streaming ? <Text class="text-[10px] text-muted-foreground">生成中</Text> : null}
        </Button>
      </View>
      <If when={open()}>
        <View class="mt-1 rounded-md border border-border bg-muted px-3 py-2">
          <Text class="text-[11.5px] text-muted-foreground" style={{ lineHeight: 18 }}>
            {props.text}
          </Text>
        </View>
      </If>
    </View>
  );
}
