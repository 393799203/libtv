> For the complete documentation index, see [llms.txt](https://developer.topazlabs.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer.topazlabs.com/getting-started/video-quickstart.md).

# Video Quickstart

In this example, we’ll be using one of our popular video models, Apollo.

Before we proceed, you need to create an [API key](https://account.topazlabs.com/manage-api).

This key will be used to authenticate your requests to the Topaz Labs API.

<details>

<summary>How do I get my API key?</summary>

In order to get access to the API, you'll need to [log into](http://topazlabs.com/account) your Topaz Labs account and create your unique API key. If you don't have an account, please follow the link [here](https://topazlabs.com/wp-login.php?action=register) to register.

<figure><img src="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FfZIUgj5DjklIDdEbPtZq%2FTopaz%20Labs%20API%20Key%20Guide.gif?alt=media&amp;token=b414b4c9-6693-484c-81fd-1ba64bdbc172" alt=""><figcaption></figcaption></figure>

1. Log into your Topaz Labs account from our [website](https://topazlabs.com/my-account/)
2. Navigate to the **API Keys** section in your account portal, enter a name, and click **Create**
3. Copy your API key (displayed at the top of the screen) and store it in a safe place

{% hint style="warning" %}
You may only view your API key on creation, so please be sure to copy the key as it will no longer be visible to you once you exit the page. If you lose your key, you may log into your account portal to manage your existing keys and generate new ones.
{% endhint %}

</details>

Now, proceed with the below steps.

{% stepper %}
{% step %}

### Create Video Request

Create a video request—just include some details about the source video, output parameters, and desired enhancements.

{% hint style="info" %}
Visit out [API Reference](https://developer.topazlabs.com/api-reference) page for up-to-date functionality. This endpoint is free to use.
{% endhint %}

```c
curl --request POST \
     --url https://api.topazlabs.com/video/ \
     --header 'X-API-Key: Your-API-Key' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '
     {
          "source": {
               "resolution": {
                    "width": 800,
                    "height": 448
               },
               "container": "mp4",
               "size": 477010,
               "duration": 4,
               "frameRate": 24,
               "frameCount": 97
          },
          "output": {
               "resolution": {
                    "width": 800,
                    "height": 448
               },
               "audioCodec": "AAC",
               "audioTransfer": "Copy",
               "frameRate": 24,
               "dynamicCompressionLevel": "High",
               "container": "mp4"
          },
          "filters": [ {
               "model": "apo-8",
               "slowmo": 1,
               "fps": 60,
               "duplicate": true,
               "duplicateThreshold": 0.1
               } ]
     }'
```

{% endstep %}

{% step %}

### Accept & Upload Video Request

After submitting the video request, you can choose to continue by calling this endpoint.

```c
curl --request PATCH \
     --url https://api.topazlabs.com/video/[your-requestID]/accept \
     --header 'X-API-Key: Your-API-Key' \
     --header 'accept: application/json'
```

Once this endpoint is called, you will receive a set of URL(s). You may use the following code snippet to upload the video to that link from your local device.

{% hint style="info" %}
In this example, we will upload the entire video file to a single URL due to its small file size.
{% endhint %}

```c
S3_UPLOAD_URL=[https://...]

curl --verbose --request PUT \
     --upload-file "Your-Video-File" \
     --header "Content-Type: video/mp4" \
     "$S3_UPLOAD_URL"
```

Once uploaded, you'll receive some information about your upload, including your *eTag* number. This will be useful for the next step.
{% endstep %}

{% step %}

### Complete Video Upload

After you have finished uploading your video segments, you may use the following request to confirm that all of your video segments have been received. Once this endpoint is called, you video will begin processing with its enhancements.

```c
curl --request PATCH \
     --url https://api.topazlabs.com/video/[your-requestID]/complete-upload \
     --header 'X-API-Key: Your-API-Key' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '{
       "uploadResults": [
         {
           "partNum": 1,
           "eTag": "your-eTag"
         }
       ]
     }'
```

You should receive a response confirming that your request is queued for processing once you have called the endpoint.
{% endstep %}

{% step %}

### Get Video Status

You may use the following request to view the status of your video request

```c
curl --request GET \
     --url https://api.topazlabs.com/video/[your-requestID]/status \
     --header 'X-API-Key: Your-API-Key' \
     --header 'accept: application/json'
```

Once your video has finished processing, you will receive a link to download your video as a response to this endpoint.
{% endstep %}
{% endstepper %}

Congratulations! You have just completed your first Video API request! 🎉

We have now made popular video models such as Starlight Precise 2.6 and Astra 2 available as ready-to-use APIs so that you can easily integrate them into your applications.

<table data-card-size="large" data-view="cards"><thead><tr><th></th><th></th><th></th><th data-hidden data-card-cover data-type="image">Cover image</th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><a class="button secondary medium">Video • Generative</a><a class="button primary medium">New!</a></td><td><h4>Starlight Precise 2.6</h4></td><td>Upscale AI-generated and archival video to 4K with realistic faces, textures, and text.</td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FTzrLBGS7de5x7Zd0EGiN%2Fslp-4k-upscale-example_slider.jpg?alt=media&amp;token=fd897da0-97a2-4cee-9f9c-bbf1e1da2428">slp-4k-upscale-example_slider.jpg</a></td><td><a href="/video-models/starlight/starlight-precise-2.6.md">Starlight Precise 2.6</a></td></tr><tr><td><a class="button secondary medium">Video • Creative</a><a class="button primary medium">New</a></td><td><h4>Astra 2</h4></td><td>Transform AI-generated and stylized video with bold new detail and prompt-guided direction.</td><td><a href="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2FKUaLpuqXpeyzWooLCVJi%2Fvideo_18_slider.jpg?alt=media&amp;token=c0d984cf-afdb-4175-867f-8cc88cbf61b2">video_18_slider.jpg</a></td><td><a href="/video-models/astra/astra-2.md">Astra 2</a></td></tr></tbody></table>

Once you find a model that you want to use in our "Models" tab, you can grab the URL from the model's dedicated page. Individual model pages also provide some important information about the model including use cases and examples of how you can call it.

Check out our [API Playground](https://playground.topazlabs.com/) to tinker with these models and let us know your feedback and questions on our [Discord](https://discord.gg/vBCCwr28ZH).

<details>

<summary>How do I make an API call from the API Playground?</summary>

<figure><img src="https://4007072434-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FJkSwaYgAsTQke14gpXAF%2Fuploads%2F98FPQpdvxdt7HlrHBf7F%2FScreen%20Recording%20Jul%2015%202025%20from%20Topaz%20Labs.gif?alt=media&amp;token=7780ca53-79a7-4e21-99a0-8edddb7b77ea" alt=""><figcaption></figcaption></figure>

It's now easier more than ever to create and send your first API request. Once you have a Topaz Labs account and you have created your first API key, navigate over to our [API Playground](https://playground.topazlabs.com/) to better understand how to build requests. Please see the walkthrough above for an example of an image being upscaled with our Enhance Synchronous endpoint on the Image API.

</details>

### More Information

<details>

<summary>API Restrictions</summary>

* The API has access rate limits depending on the current load on the servers. If you receive a HTTP 429 response, please try again (soon). We recommend using an exponential backoff for the requests to avoid immediately hitting the limit again.
* The API only responds to HTTPS-secured communications. Any requests sent via HTTP return an HTTP 301 redirect to the corresponding HTTPS resources.
* The API enforces a request size limit of 500MB. If a request exceeds this limit, the server responds with an HTTP 413. Please ensure that requests stay within the size constraint to avoid this error.

</details>

Please reach out to <help@topazlabs.com> with any questions.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer.topazlabs.com/getting-started/video-quickstart.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
