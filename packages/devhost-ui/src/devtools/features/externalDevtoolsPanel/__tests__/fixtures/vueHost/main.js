import { createApp } from "vue";
import App from "./App.vue";
import "./nativeContext.js";

let app = createApp(App);
app.mount("#app");
document.querySelector("#unmount-app").addEventListener("click", () => app.unmount());
document.querySelector("#mount-app").addEventListener("click", () => {
  app = createApp(App);
  app.mount("#app");
});
document.querySelector("#replace-app").addEventListener("click", () => {
  app.unmount();
  app = createApp(App);
  app.mount("#app");
});
