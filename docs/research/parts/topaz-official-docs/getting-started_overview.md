> For the complete documentation index, see [llms.txt](https://developer.topazlabs.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer.topazlabs.com/getting-started/overview.md).

# Overview

Topaz Labs is the industry leader in AI-powered image and video enhancement, trusted by millions of users and professional teams worldwide. Our AI models are developed in-house by our team of PhD researchers in Dallas, Texas, to improve quality and recover detail while preserving the original intent of the source media.

The Topaz API brings our models to automated workflows at scale, with fast, reliable processing across thousands or even millions of files. Use these docs to explore our AI models and their capabilities, understand which model is best for each use case, and integrate Topaz directly into your application or pipeline.

### Getting Started

Pick the API that matches your needs.

<table data-card-size="large" data-view="cards"><thead><tr><th></th><th></th><th></th><th></th><th></th><th data-hidden data-card-cover data-type="image">Cover image</th></tr></thead><tbody><tr><td><h4>Image</h4></td><td>Per-image processing. Upscale, enhance, denoise, sharpen, and restore photos, artwork, and graphics with precise, generative, or creative models.</td><td><a href="/getting-started/quickstart.md" class="button secondary medium" data-icon="play">Quickstart</a></td><td><a href="broken://spaces/z77V5aSS5QsChodPQbj5/pages/uyyMulG4DpyN0NKmLcnm#image-api-endpoints" class="button secondary medium" data-icon="book-open">API Reference</a></td><td><a href="/getting-started/overview.md#popular-models" class="button secondary medium" data-icon="fire">Popular Models</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2Fsx7w4Y7pSq5JsCYsXikQ%2FAPI-Image-Example.jpg?alt=media&amp;token=2b851d61-a0f0-4521-b35a-202a4cbb1ed6">API-Image-Example.jpg</a></td></tr><tr><td><h4>Video</h4></td><td>Full-clip rendering. Upscale, enhance, denoise, deinterlace, and retime footage with control over codec, profile, and bit depth.</td><td><a href="/getting-started/video-quickstart.md" class="button secondary medium" data-icon="play">Quickstart</a></td><td><a href="broken://spaces/z77V5aSS5QsChodPQbj5/pages/uyyMulG4DpyN0NKmLcnm#video-api-endpoints" class="button secondary medium" data-icon="book-open">API Reference</a></td><td><a href="/getting-started/overview.md#popular-models" class="button secondary medium" data-icon="fire">Popular Models</a></td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2F0aBjwSuP3367ok4QGtKt%2FAPI-Video-Example.jpg?alt=media&amp;token=30c9f578-d9f8-4577-88a7-ca72cbf83a96">API-Video-Example.jpg</a></td></tr></tbody></table>

### Popular Models

Get started with one of our top upscaling models.

<table data-column-title-hidden data-card-wrap="false" data-view="cards"><thead><tr><th></th><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><a class="button secondary medium">Image | Precision</a></td><td><h4>Standard 2</h4></td><td>Trusted, industry-standard image upscaling that preserves natural detail and texture across photos and graphics.</td><td><a href="/video-models/proteus/proteus.md">Proteus</a></td></tr><tr><td><a class="button secondary medium">Image | Generative</a><a class="button primary medium">New!</a></td><td><h4>Wonder 3.5</h4></td><td>Most advanced generative precision upscaling for all image types, delivering realistic detail and exceptional quality on low-res sources and text.</td><td><a href="/video-models/starlight/starlight-precise-2.6.md">Starlight Precise 2.6</a></td></tr><tr><td><a class="button secondary medium">Image | Creative</a><a class="button primary medium">New!</a></td><td><h4>Bloom 2</h4></td><td>Creative generative upscaling designed to transform GenAI images with new realistic detail and texture.</td><td><a href="/video-models/astra/astra-2.md">Astra 2</a></td></tr></tbody></table>

<table data-column-title-hidden data-card-wrap="false" data-view="cards"><thead><tr><th></th><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><a class="button secondary medium">Video | Precision</a></td><td><h4>Proteus</h4></td><td>Popular default model for general-purpose video upscaling, denoising, and sharpening across a wide range of sources.</td><td><a href="/video-models/proteus/proteus.md">Proteus</a></td></tr><tr><td><a class="button secondary medium">Video | Generative</a><a class="button primary medium">New!</a></td><td><h4>Starlight Precise 2.6</h4></td><td>Recommended upscaling for both GenAI and archival video sources, with realistic detail and improved temporal consistency.</td><td><a href="/video-models/starlight/starlight-precise-2.6.md">Starlight Precise 2.6</a></td></tr><tr><td><a class="button secondary medium">Video | Creative</a><a class="button primary medium">New!</a></td><td><h4>Astra 2</h4></td><td>Creative diffusion upscaling transforms GenAI video sources, with prompt-guided detail and clarity.</td><td><a href="/video-models/astra/astra-2.md">Astra 2</a></td></tr></tbody></table>

### Other Use Cases

Explore some of our other model families.

<table data-column-title-hidden data-view="cards"><thead><tr><th></th><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><a class="button secondary medium">Image | Denoise</a></td><td><h4>Denoise Max</h4></td><td>Remove noise and grain, sharpening soft areas while retaining sharp detail.</td><td><a href="/image-models/denoise/max.md">Max</a></td></tr><tr><td><a class="button secondary medium">Video | Frame Interpolation</a></td><td><h4>Apollo</h4></td><td>Retime footage for smooth slow motion and frame rate conversion at exact 2x, 4x, or 8x.</td><td><a href="/video-models/frame-interpolation/apollo.md">Apollo</a></td></tr><tr><td><a class="button secondary medium">Video | SDR to HDR</a><a class="button primary medium">New!</a></td><td><h4>Hyperion 2.5</h4></td><td>Convert SDR and AI-generated video to HDR, with 10-bit ProRes and 16-bit EXR output.</td><td><a href="/video-models/video-utilities/hyperion-2.5-sdr-to-hdr-new.md">Hyperion 2.5 (SDR to HDR) — New!</a></td></tr></tbody></table>

Didn't find what you're looking for? Check out our model selection guide [here](/getting-started/model-selection.md).

### Keep Learning

Check out some of our other helpful resources.

<table data-view="cards"><thead><tr><th></th><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><i class="fa-stars">:stars:</i></td><td><h4>What's New</h4></td><td>Check out our latest release.</td><td></td></tr><tr><td><i class="fa-cube">:cube:</i></td><td><h4>Model Selection</h4></td><td>Find the best model for your use case.</td><td><a href="/getting-started/model-selection.md">Model Selection</a></td></tr><tr><td><i class="fa-tag">:tag:</i></td><td><h4>Model Pricing</h4></td><td>Learn how we price our models.</td><td></td></tr><tr><td><i class="fa-codepen">:codepen:</i></td><td><h4>Model Playground</h4></td><td>Test and create with our models.</td><td><a href="https://playground.topazlabs.com/">https://playground.topazlabs.com/</a></td></tr><tr><td><i class="fa-square-root-variable">:square-root-variable:</i></td><td><h4>Credit Calculator</h4></td><td>Pricing for specific outputs, batches, and more.</td><td></td></tr><tr><td><i class="fa-circle-question">:circle-question:</i></td><td><h4>FAQs</h4></td><td>Get your questions answered.</td><td></td></tr></tbody></table>


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer.topazlabs.com/getting-started/overview.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
