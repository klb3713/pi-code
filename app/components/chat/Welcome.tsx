// Empty-state welcome surface with suggested first tasks.
import { computed, Text, View } from "nsh";
import { Button } from "nsh/base";
import { actions, busy, connection } from "../../store";
import { BrandMark, Glyph } from "../common/ui";

interface Suggestion {
  icon: string;
  title: string;
  detail: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: "＋",
    title: "创建一个 hello.ts 并打印 Hello",
    detail: "写一个最小的 TypeScript 脚本",
  },
  {
    icon: "▤",
    title: "看看这个项目里有什么",
    detail: "浏览目录结构与关键文件",
  },
  {
    icon: "⌘",
    title: "运行 git status 并总结",
    detail: "检查当前工作区的变更",
  },
];

export function Welcome() {
  const disabled = computed(() => connection() !== "connected" || busy());
  return (
    <View class="w-full flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
      <BrandMark size={40} />
      <View class="flex-col items-center gap-2">
        <Text class="text-center text-[22px] font-semibold text-foreground">今天想构建什么？</Text>
        <Text class="text-center text-[12.5px] text-muted-foreground" style={{ lineHeight: 20 }}>
          让 pi 在你的工作区里读代码、改文件、跑命令
        </Text>
      </View>
      <View class="w-full flex-col gap-2" style={{ maxWidth: 520 }}>
        <Each of={SUGGESTIONS} key={(item) => item.title}>
          {(item) => (
            <Button
              disabled={disabled()}
              onPress={() => void actions.send(item().title)}
              class="w-full flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-surface-raised active:bg-surface-raised disabled:opacity-50"
            >
              <View class="h-7 w-7 items-center justify-center rounded-md bg-secondary">
                <Glyph symbol={item().icon} size={12} class="text-primary" />
              </View>
              <View class="flex-1 flex-col gap-0.5">
                <Text class="text-[12.5px] font-medium text-foreground">{item().title}</Text>
                <Text class="text-[10.5px] text-muted-foreground">{item().detail}</Text>
              </View>
              <Glyph symbol="→" size={12} />
            </Button>
          )}
        </Each>
      </View>
    </View>
  );
}
