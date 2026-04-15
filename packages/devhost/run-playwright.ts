import { chromium } from "playwright";
import { exec } from "child_process";

async function main() {
  const server = exec("python3 -m http.server 3000 --directory out");

  // give it a sec to start
  await new Promise((r) => setTimeout(r, 1000));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("pageerror", (err) => console.log("PAGE ERROR:", err));
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));

  await page.goto("http://localhost:3000/test-app2.html");

  // wait for the devtools to be in the DOM
  await page.waitForSelector(".tsqd-main-panel", { timeout: 5000 });

  console.log("Initial state:");
  let style = await page.evaluate(() => {
    const el = document.querySelector(".tsqd-main-panel");
    const style = window.getComputedStyle(el);
    const parentStyle = window.getComputedStyle(el.closest(".tsqd-parent-container") || el);
    return {
      el: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        transform: style.transform,
      },
      parent: {
        display: parentStyle.display,
        visibility: parentStyle.visibility,
        opacity: parentStyle.opacity,
        transform: parentStyle.transform,
      },
    };
  });
  console.log(style);

  // click close button
  console.log("Clicking close...");
  await page.click('.tsqd-minimize-btn, .tsqd-main-panel button[aria-label="Close tanstack query devtools"]');

  await page.waitForTimeout(1000); // Wait for animation

  console.log("State after close:");
  style = await page.evaluate(() => {
    const el = document.querySelector(".tsqd-main-panel");
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const parentStyle = window.getComputedStyle(el.closest(".tsqd-parent-container") || el);
    return {
      el: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        transform: style.transform,
      },
      parent: {
        display: parentStyle.display,
        visibility: parentStyle.visibility,
        opacity: parentStyle.opacity,
        transform: parentStyle.transform,
      },
    };
  });
  console.log(style);

  console.log("State of root container after close:");
  style = await page.evaluate(() => {
    const roots = document.querySelectorAll(".tsqd-parent-container");
    return Array.from(roots).map((el) => {
      const style = window.getComputedStyle(el);
      return {
        className: el.className,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        transform: style.transform,
        height: style.height,
        maxHeight: style.maxHeight,
        overflow: style.overflow,
      };
    });
  });
  console.log(style);

  await browser.close();
  server.kill();
}

main().catch(console.error);
