> For the complete documentation index, see [llms.txt](https://developer.topazlabs.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer.topazlabs.com/getting-started/model-pricing.md).

# Model Pricing

Flexible, per-use pricing that scales with you

Pay only for what you process — billed per output megapixel across all image models. No subscriptions, no minimums, no expiration. Use our [credit calculator](https://developer.topazlabs.com/credit-calculator) to estimate costs before you build.

### Credits

Credits are the currency of the Topaz Labs API. All image processing is billed in credits, deducted automatically when a job completes.

### How MP Output is Calculated

Billing is based on the **output** resolution of your processed image — not the input.

### Model Family Pricing

The following are the pricing families for our Image API and Video API.

#### Image Pricing

{% hint style="info" %}
Image models are priced linearly based on MP output (e.g. 1 credit = 24 MP of output).
{% endhint %}

| Use Case           | Model Family                                                | Output MP Per Credit               |
| ------------------ | ----------------------------------------------------------- | ---------------------------------- |
| Precision Upscale  | [`Gigapixel`](/image-models/gigapixel.md)                   | 24                                 |
| Generative Upscale | [`Wonder`](/image-models/wonder.md)                         | 4                                  |
| Creative Upscale   | [`Bloom`](/image-models/bloom.md)                           | 2                                  |
| Sharpen            | [`Sharpen`](/image-models/sharpen.md)                       | <p>GAN — 24<br>Generative — 20</p> |
| Denoise            | [`Denoise`](/image-models/denoise.md)                       | 24                                 |
| Image Utilities    | [`Removal & Cleanup`](/image-models/removal-and-cleanup.md) | 24                                 |
| Image Utilities    | [`Color & Lighting`](/image-models/color-and-lighting.md)   | 24                                 |

#### Video Pricing

{% hint style="info" %}
Video credit costs are all estimates calculated based on 10s at 1080p 30fps. For pricing tables at various durations and output resolutions, visit the model family pages linked below. We recommend using out our [credit calculator](https://developer.topazlabs.com/credit-calculator) for larger batch estimates.
{% endhint %}

| Use Case           | Model Family                                                  | Credits Per Video               |
| ------------------ | ------------------------------------------------------------- | ------------------------------- |
| Precision Upscale  | [`Proteus`](/video-models/proteus.md)                         | 4                               |
| Generative Upscale | [`Starlight`](/video-models/starlight.md)                     | <p>Fast — 6<br>Quality — 12</p> |
| Creative Upscale   | [`Astra`](/video-models/astra.md)                             | 40                              |
| Denoise            | [`Denoise`](/video-models/denoise.md)                         | <p>Fast — 2<br>Quality — 4</p>  |
| Motion             | [`Frame Interpolation`](/video-models/frame-interpolation.md) | <p>Fast — 1<br>Quality — 2</p>  |
| Video Utilities    | [`Video Utilities`](/video-models/video-utilities.md)         | 2                               |

{% hint style="info" %}
There are a few exceptions to some of the families. Click into a given family to view all prices, or view our individual model pricing page.
{% endhint %}

To access our most update-to-date pricing, please visit our [website](https://www.topazlabs.com/enhance-api). Looking for a custom solution? Contact our team at <enterprise@topazlabs.com> and we'll be in touch about our enterprise plans.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer.topazlabs.com/getting-started/model-pricing.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
