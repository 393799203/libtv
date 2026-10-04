> For the complete documentation index, see [llms.txt](https://developer.topazlabs.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer.topazlabs.com/video-models/frame-interpolation.md).

# Frame Interpolation

AI Powered Retiming and Frame Interpolation

### Model Family Overview

Specialized frame interpolation models designed to precisely change frame rates or create smooth slow motion by creating new, intermediate frames while preserving motion continuity and visual detail.

### Key Features

**Adjust frame rate with smooth, natural motion.**

* Convert footage between common or custom frame rates without introducing jitter.

**Create fluid slow motion at any speed.**

* Generate intermediate frames to extend time while maintaining believable movement.

**Handle complex motion with minimal artifacts.**

* Advanced motion estimation manages parallax, reflections, and non-linear movement.

### Pricing

Our frame interpolation models cost varying credits per output GP generated. We recommend referencing specific model pages for actual estimates.

<table><thead><tr><th>Model</th><th width="367.3740234375">Credits per GP</th></tr></thead><tbody><tr><td><code>Aion</code></td><td>6</td></tr><tr><td><code>Apollo</code> <code>Chronos</code></td><td>2</td></tr><tr><td><code>Apollo Fast</code> <code>Chronos Fast</code></td><td>1</td></tr></tbody></table>

### Models

#### "Quality" Models

<table data-view="cards"><thead><tr><th></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="image">Cover image</th></tr></thead><tbody><tr><td><code>Aion</code></td><td><a href="/video-models/frame-interpolation/aion.md">Aion</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FKXZdc9eLZ0g8ISjVZCec%2FScreenshot%202026-03-24%20at%207.36.32%E2%80%AFPM.png?alt=media&amp;token=2a7da9e3-32d0-4d0e-b602-1c1d1250e519">Screenshot 2026-03-24 at 7.36.32 PM.png</a></td></tr><tr><td><code>Apollo</code></td><td><a href="/video-models/frame-interpolation/apollo.md">Apollo</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FaaiiuZdLgm3a8cvoQArR%2FScreenshot%202026-03-24%20at%207.36.45%E2%80%AFPM.png?alt=media&amp;token=46c0325f-1418-4d7a-8646-444df88e5165">Screenshot 2026-03-24 at 7.36.45 PM.png</a></td></tr><tr><td><code>Chronos</code></td><td><a href="/video-models/frame-interpolation/chronos.md">Chronos</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FY8cLCg4W3KUDKpkWQlaK%2FChronos_slider.jpg?alt=media&amp;token=125b4362-4f38-499a-bbf3-8e83a649d1d0">Chronos_slider.jpg</a></td></tr></tbody></table>

#### "Fast" Models

<table data-view="cards"><thead><tr><th></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="image">Cover image</th></tr></thead><tbody><tr><td><code>Apollo Fast</code></td><td><a href="broken://pages/dNHtFXtpCMkrraa22s9w">Broken link</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FsveKqKpoM8RIpyRYZn1D%2FApollo_Fast_slider.jpg?alt=media&amp;token=91ddbd10-12f2-408d-9ba9-4d79533047fd">Apollo_Fast_slider.jpg</a></td></tr><tr><td><code>Chronos Fast</code></td><td><a href="broken://pages/5rUaTuF8aMBBuSfjWfg0">Broken link</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FufUyFNHZvcxQQxUCWu8m%2FChronos_Fast_slider.jpg?alt=media&amp;token=341e0eb7-8b67-48e5-9a1c-ba36ec81b266">Chronos_Fast_slider.jpg</a></td></tr></tbody></table>


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer.topazlabs.com/video-models/frame-interpolation.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
