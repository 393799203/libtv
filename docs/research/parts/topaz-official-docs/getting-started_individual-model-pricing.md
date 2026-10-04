> For the complete documentation index, see [llms.txt](https://developer.topazlabs.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer.topazlabs.com/getting-started/individual-model-pricing.md).

# Individual Model Pricing

| Model                     | Type  | Price                              |
| ------------------------- | ----- | ---------------------------------- |
| Standard 2                | Image | 24                                 |
| High Fidelity 2           | Image | 4                                  |
| High Fidelity 3           | Image | 2                                  |
| Low Resolution 2          | Image | <p>GAN — 24<br>Generative — 20</p> |
| Art & CGI                 | Image | 24                                 |
| Transparent Image Upscale | Image | 24                                 |
| Detail Faces              | Image | 24                                 |
| Recover Faces             | Image |                                    |
| Face Recovery 3           | Image |                                    |
| Text & Shapes             | Image |                                    |
| Redefine                  | Image |                                    |
| Wonder                    | Image |                                    |
| Wonder 2                  | Image |                                    |
| Wonder 3                  | Image |                                    |
| Standard Max              | Image |                                    |
| Recover 3                 | Image |                                    |
| Bloom Creative            | Image |                                    |
| Bloom Realism             | Image |                                    |
| Denoise Normal            | Image |                                    |
| Denoise Strong            | Image |                                    |
| Denoise Extreme           | Image |                                    |
| Denoise Max               | Image |                                    |
| Dust & Scratch 2          | Image |                                    |
| Image Object Matting      | Image |                                    |
| Background Removal        | Image |                                    |
| Sharpen Standard          | Image |                                    |
| Sharpen Strong            | Image |                                    |
| Noise-Aware Sharpen       | Image |                                    |
| Portrait                  | Image |                                    |
| Wildlife                  | Image |                                    |
| Natural                   | Image |                                    |
| Refocus                   | Image |                                    |
| Motion Blur               | Image |                                    |
| Lens Blur 2               | Image |                                    |
| Super Focus 2             | Image |                                    |
| Super Focus 3             | Image |                                    |
| Adjust Lighting 2         | Image |                                    |
| Balance Color             | Image |                                    |
| Image Colorization        | Image |                                    |
| Proteus                   | Video |                                    |
| Proteus Natural           | Video |                                    |
| Rhea                      | Video |                                    |
| Theia                     | Video |                                    |
| Theia Fine Tune Detail    | Video |                                    |
| Theia Fine Tune Fidelity  | Video |                                    |
| Artemis Aliasing / Moire  | Video |                                    |
| Artemis Low Quality       | Video |                                    |
| Artemis Medium Quality    | Video |                                    |
| Artemis High Quality      | Video |                                    |
| Artemis Medium Halo       | Video |                                    |
| Artemis Strong Halo       | Video |                                    |
| Dione DV                  | Video |                                    |
| Dione TV                  | Video |                                    |
| Dione Robust              | Video |                                    |
| Dione Dehalo              | Video |                                    |
| Dione Robust Dehalo       | Video |                                    |
| Gaia High Quality         | Video |                                    |
| Gaia CG                   | Video |                                    |
| Gaia 2 (Animation)        | Video |                                    |
| Iris Low Quality          | Video |                                    |
| Iris Medium Quality       | Video |                                    |
| Starlight Precise 2.5     | Video |                                    |
| Starlight HQ              | Video |                                    |
| Starlight Mini            | Video |                                    |
| Starlight Sharp           | Video |                                    |
| Starlight Fast 2          | Video |                                    |
| Astra 1                   | Video |                                    |
| Astra 2                   |       |                                    |
| Nyx                       |       |                                    |
| Nyx High Fidelity         |       |                                    |
| Nyx XL                    |       |                                    |
| Nyx Fast                  |       |                                    |
| Aion                      |       |                                    |
| Apollo                    |       |                                    |
| Apollo Fast               |       |                                    |
| Chronos                   |       |                                    |
| Chronos Fast              |       |                                    |
| Themis 2 (Motion Deblur)  |       |                                    |
| Video Colorization        |       |                                    |
| Hyperion (SDR to HDR)     |       |                                    |
| Hyperion 2 (SDR to HDR)   |       |                                    |
|                           |       |                                    |


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer.topazlabs.com/getting-started/individual-model-pricing.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
