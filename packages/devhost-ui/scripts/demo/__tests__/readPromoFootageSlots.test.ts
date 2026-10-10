import { expect, it } from "bun:test";
import { readPromoFootageSlots } from "../readPromoFootageSlots";

it("reads every footage request from a frame, including the ones inside its template", async () => {
  const html = `<template>
    <div id="root" data-composition-id="03-start">
      <video id="start-terminal" class="clip" src="assets/footage/start-terminal.mp4" muted playsinline
        data-footage="startup" data-footage-to="-5" data-start="1.2" data-duration="4.5" data-track-index="1"></video>
      <video id="start-browser" src="assets/footage/start-browser.mp4" muted playsinline
        data-footage="overview-1" data-footage-from="-2.5" data-start="5.7" data-duration="2"></video>
      <video id="logo-loop" src="assets/logo.mp4" data-start="0" data-duration="3"></video>
    </div>
  </template>`;
  expect(await readPromoFootageSlots(html)).toEqual([
    {
      id: "start-terminal",
      sourceId: "startup",
      outputPath: "assets/footage/start-terminal.mp4",
      duration: 4.5,
      from: 0,
      to: -5,
    },
    {
      id: "start-browser",
      sourceId: "overview-1",
      outputPath: "assets/footage/start-browser.mp4",
      duration: 2,
      from: -2.5,
      to: undefined,
    },
  ]);
});

it("rejects a footage request without a slot length", async () => {
  await expect(
    readPromoFootageSlots('<video id="hero" src="assets/footage/hero.mp4" data-footage="query-1"></video>'),
  ).rejects.toThrow("Footage video hero needs a positive data-duration");
});

it("rejects a footage request that would write outside the staged footage directory", async () => {
  await expect(
    readPromoFootageSlots('<video id="hero" src="../hero.mp4" data-footage="query-1" data-duration="2"></video>'),
  ).rejects.toThrow("Footage video hero must use a src under assets/footage/");
});

it("rejects a window offset that is not a number", async () => {
  await expect(
    readPromoFootageSlots(
      '<video id="hero" src="assets/footage/hero.mp4" data-footage="query-1" data-duration="2" data-footage-to="end"></video>',
    ),
  ).rejects.toThrow("Footage video hero has an invalid data-footage-to");
});
