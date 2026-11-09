// Test entry: mount Pi Code with the deterministic fake transport.
//
// It lives at the repository root (not under tests/) so `nsh test` bundles it
// with the app's nsh.json theme: the fake-driven UI then draws with the same
// design tokens as the real App.tsx entry.
import { mount } from "nsh";
import { setTransport } from "./app/store";
import { App } from "./app/App";
import { createFakeTransport } from "./tests/fake-transport";

export const fake = createFakeTransport();
setTransport(fake);
mount(App);
