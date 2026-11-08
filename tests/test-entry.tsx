// Test entry: mount Pi Code with the deterministic fake transport.
import { mount } from "nsh";
import { setTransport } from "../app/store";
import { App } from "../app/App";
import { createFakeTransport } from "./fake-transport";

export const fake = createFakeTransport();
setTransport(fake);
mount(App);
