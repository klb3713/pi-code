// Small unstyled-but-themed primitives shared across Pi Code.
import { Text, View } from "nsh";
import { Button } from "nsh/base";

export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 28;
  return (
    <View
      class="items-center justify-center bg-primary"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <Text class="font-semibold text-primary-foreground" style={{ fontSize: Math.round(size * 0.56), lineHeight: size }}>
        π
      </Text>
    </View>
  );
}

export function Glyph(props: { symbol: string; class?: string; size?: number }) {
  return (
    <Text class={props.class ?? "text-muted-foreground"} style={{ fontSize: props.size ?? 13, lineHeight: (props.size ?? 13) + 4 }}>
      {props.symbol}
    </Text>
  );
}

export function IconButton(props: {
  symbol: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  class?: string;
  symbolClass?: string;
}) {
  const size = props.size ?? 28;
  return (
    <Button
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      class={`items-center justify-center rounded-md transition-colors ${
        props.active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent"
      } ${props.class ?? ""}`}
      style={{ width: size, height: size }}
    >
      <Glyph symbol={props.symbol} size={14} class={props.symbolClass ?? (props.active ? "text-foreground" : "text-muted-foreground")} />
    </Button>
  );
}

export function Spinner(props: { size?: number }) {
  const size = props.size ?? 14;
  return (
    <View
      class="rounded-full border-2 border-border border-t-primary animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

export function StatusDot(props: { tone?: "success" | "warning" | "error" | "muted" | "primary"; size?: number }) {
  const size = props.size ?? 6;
  const colors: Record<string, string> = {
    success: "bg-success",
    warning: "bg-warning",
    error: "bg-destructive",
    muted: "bg-muted-foreground",
    primary: "bg-primary",
  };
  return <View class={`rounded-full ${colors[props.tone ?? "muted"]}`} style={{ width: size, height: size }} />;
}

export function Tag(props: { text: string; tone?: "default" | "primary" | "success" | "warning" | "error" | "info"; class?: string }) {
  const tones: Record<string, string> = {
    default: "bg-secondary text-secondary-foreground",
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    error: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
  };
  return (
    <View class={`rounded-full px-1.5 py-0.5 ${tones[props.tone ?? "default"]} ${props.class ?? ""}`}>
      <Text class="text-[10px] font-medium" style={{ lineHeight: 14 }}>
        {props.text}
      </Text>
    </View>
  );
}

export function Kbd(props: { text: string }) {
  return (
    <View class="rounded border border-border bg-muted px-1 py-0.5">
      <Text class="font-mono text-[10px] text-muted-foreground">{props.text}</Text>
    </View>
  );
}

export function SectionLabel(props: { text: string; class?: string }) {
  return (
    <Text class={`text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${props.class ?? ""}`}>
      {props.text}
    </Text>
  );
}

export function Divider(props: { class?: string }) {
  return <View class={`h-px bg-border ${props.class ?? ""}`} />;
}

export function EmptyHint(props: { title: string; detail?: string; icon?: string }) {
  return (
    <View class="flex-1 items-center justify-center gap-2 px-6 py-10">
      <Text class="text-[22px] text-muted-foreground" style={{ lineHeight: 28 }}>
        {props.icon ?? "·"}
      </Text>
      <Text class="text-[12px] font-medium text-muted-foreground">{props.title}</Text>
      {props.detail ? <Text class="text-center text-[11px] text-muted-foreground">{props.detail}</Text> : null}
    </View>
  );
}
