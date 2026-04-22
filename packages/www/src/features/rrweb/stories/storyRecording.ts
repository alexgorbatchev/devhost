import type { IRrwebDemoRecording } from "../types";

const storyRecording: IRrwebDemoRecording = {
  durationMs: 3000,
  events: [
    {
      type: 4,
      data: {
        href: "http://127.0.0.1:6007/iframe.html?id=devhost-test-app-features-rrweb-featurereplaypanel--loaded-replay",
        width: 1280,
        height: 720,
      },
      timestamp: 1,
    },
    {
      type: 2,
      data: {
        node: {
          type: 0,
          id: 0,
          childNodes: [
            {
              type: 1,
              name: "html",
              publicId: "",
              systemId: "",
              id: 1,
            },
            {
              type: 2,
              tagName: "html",
              attributes: {
                lang: "en",
              },
              childNodes: [
                {
                  type: 2,
                  tagName: "head",
                  attributes: {},
                  childNodes: [
                    {
                      type: 2,
                      tagName: "title",
                      attributes: {},
                      childNodes: [
                        {
                          type: 3,
                          textContent: "Story replay",
                          id: 5,
                        },
                      ],
                      id: 4,
                    },
                  ],
                  id: 3,
                },
                {
                  type: 2,
                  tagName: "body",
                  attributes: {
                    style: "margin:0;background:#0f172a;color:#e2e8f0;font-family:Inter, sans-serif;",
                  },
                  childNodes: [
                    {
                      type: 2,
                      tagName: "main",
                      attributes: {
                        style: "display:grid;min-height:100vh;place-items:center;padding:32px;",
                      },
                      childNodes: [
                        {
                          type: 2,
                          tagName: "section",
                          attributes: {
                            style:
                              "width:100%;max-width:640px;border-radius:24px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.92);padding:32px;box-sizing:border-box;",
                          },
                          childNodes: [
                            {
                              type: 2,
                              tagName: "p",
                              attributes: {
                                style:
                                  "margin:0 0 12px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#38bdf8;",
                              },
                              childNodes: [
                                {
                                  type: 3,
                                  textContent: "devhost",
                                  id: 10,
                                },
                              ],
                              id: 9,
                            },
                            {
                              type: 2,
                              tagName: "h1",
                              attributes: {
                                style: "margin:0 0 16px;font-size:32px;line-height:1.2;",
                              },
                              childNodes: [
                                {
                                  type: 3,
                                  textContent: "Replay preview fixture",
                                  id: 12,
                                },
                              ],
                              id: 11,
                            },
                            {
                              type: 2,
                              tagName: "p",
                              attributes: {
                                style: "margin:0;font-size:16px;line-height:1.6;color:#cbd5e1;",
                              },
                              childNodes: [
                                {
                                  type: 3,
                                  textContent:
                                    "This lightweight rrweb recording keeps Storybook replay coverage deterministic in CI.",
                                  id: 14,
                                },
                              ],
                              id: 13,
                            },
                          ],
                          id: 8,
                        },
                      ],
                      id: 7,
                    },
                  ],
                  id: 6,
                },
              ],
              id: 2,
            },
          ],
        },
        initialOffset: {
          top: 0,
          left: 0,
        },
      },
      timestamp: 2,
    },
  ],
};

export function useStoryRecording(): IRrwebDemoRecording | null {
  return storyRecording;
}
