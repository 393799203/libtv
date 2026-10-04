# libtv 技术调研 03：开源模型 / 自建 GPU 推理路线（视频超分 + 补帧）

> 调研日期：**2026-10-04**。所有数据尽可能标注来源 URL；查不到确切数据的项在文末「未证实清单」中集中列出，文中出现 **【推算】** 的数值为基于已证实锚点推导，**非官方实测**。
> 汇率：1 USD = 6.72 CNY（open.er-api.com，2026-10-04）。
> 目标场景：**漫剧/短剧 AI 视频生成平台**，把 480p 成片（854×480）清晰化到 720p/1080p，并补帧到 60fps。内容以**动漫风格（2D/三渲二）**为主，兼有写实短剧。

---

## 0. 三段话结论（TL;DR）

1. **纯 GAN + 光流 的「保守超分 + 补帧」流水线（Real-CUGAN / Real-ESRGAN + RIFE）是自建的最优解**：RTX 4090 上处理 1 分钟 480p→1080p@60fps 约需 **170–660 GPU·秒**（约 3–11 分钟墙钟），折合 **¥0.09–0.36 / 分钟成片**（AutoDL 4090 ¥1.98/时）。相比腾讯云 MPS ¥3.36/分钟、Topaz 约 ¥9–11/分钟，**便宜 10–35 倍**。置信度：**中**（GPU 吞吐为【推算】，价格为一手抓取）。
2. **生成式修复（SeedVR2）自建不合算**：SeedVR2 质量是当前 SOTA，但其因果 3D VAE 是绝对瓶颈（官方论文承认 720p×100 帧时 **VAE 占 >95% 总时间**）。估算 H100 级约 **1.5–3.5 GPU·小时 / 分钟成片 → ¥16–37/分钟**，反而比买 API 贵 5–11 倍。**只适合做关键镜头/封面级精修，不适合全量批处理**。置信度：**低**。
3. **许可红线**：`SUPIR` 明确**仅限非商用**（SupPixel Pty Ltd 专有许可）；`Video2X` 是 **AGPL-3.0**（网络服务会触发源码开放义务）；`chaiNNer` 是 **GPL-3.0**。可安全商用的是 **BSD-3（Real-ESRGAN）/ MIT（Real-CUGAN、Anime4K、RIFE、waifu2x、**GMFSS_Fortuna**）/ Apache-2.0（SeedVR2 代码+权重、BasicSR、AnimeSR、HAT、DAT、SwinIR、EMA-VFI）**。**动漫补帧的画质上限方案 GMFSS_Fortuna 已核实为 MIT → 可放心自建。**
4. **补帧选型（已一手核实官方文档）**：RIFE 官方推荐 **4.25**（官方原文称「动漫场景显著改进」），且 **4.24+ 明确适合扩散生成视频的后处理**（正好覆盖 libtv 的 AI 生成素材）。动漫高画质档用 **GMFSS_Fortuna**（MIT，动漫专用，`--union` + anime-flow fine-tuned 权重）。2024–2025 新方案 **VFIMamba**（NeurIPS2024，SSM/Mamba，宣称高分辨率友好）与 **MoMo**（AAAI2025，有 10M 轻量版）**均为 Apache-2.0 且值得 A/B**，但**尚无动漫验证**。

**前提（重要）**：libtv 现有部署是 docker-compose（frontend/backend/db/redis），**没有任何 GPU 资源**。走自建路线意味着二选一：① 新购 GPU 机器（4090 整机约 ¥1.5–2 万量级，本次未抓取报价 →【未证实】）；② 买云 GPU（按量 ¥1.19–1.98/时）。**在月处理量低于约 3,000–5,000 分钟成片时，云 GPU 按量 + 本地无卡调试是更稳的选择**（无沉没成本、可弹性扩容）。

---

## 1. 视频/图像超分与修复模型清单

### 1.1 实战首选：动漫向 GAN 超分

| 模型 | 仓库 / 来源 | ★ | 最近更新 | 许可 | 可商用 | 倍率 | 视频 | 倾向 | 显存 | 480p→1080p 速度量级 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Real-CUGAN** | [bilibili/ailab](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) | 见 ailab 主仓 | 2022-08（README 更新） | **MIT** | ✅ | 2x/3x/4x，2x 支持 4 档降噪 + 保守版 | 是（`inference_video.py`） | **动漫专用**（百万级动漫 patch 训练） | N 卡 ≥1.5G；`cache_mode`/`tile` 可调 | 官方对比表：**1080p 耗时 = waifu2x(CUNet) 的 1x，Real-ESRGAN(Anime6B) 的 1/2.2**【实测·官方】 |
| **Real-ESRGAN** | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | 36975 | 2024-08-06 | **BSD-3-Clause** | ✅ | 4x 原生，`--outscale` 任意档（内部 LANCZOS4 二次缩放） | 是（`inference_realesrgan_video.py`，支持多进程/多卡） | 通用偏写实；`anime_6B` 偏动漫 | fp16 默认；`-t` tile 可降 | 官方：比 CUNet **慢 2.2x**（Anime6B 档）；`animevideov3`（XS 小模型）显著更快 |
| ├ **realesr-animevideov3** | 同上 `docs/anime_video_model.md` | — | 2022-02（v0.2.5.0） | BSD-3-Clause | ✅ | X4 模型，**可用于 X1/X2/X3** | 是（官方 ffmpeg 拆帧→推理→合帧流程） | **动漫视频专用小模型** | 极小 | **最快档**；官方明确「不建议开 TTA」 |
| **Anime4K** | [bloc97/Anime4K](https://github.com/bloc97/Anime4K) | 21460 | 活跃 | **MIT** | ✅ | x2/x3/x4（GLSL shader） | 是（实时，mpv/Plex 滤镜） | 动漫 | 极小（实时渲染器） | **实时**（播放级） |
| **waifu2x** | [nihui/waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) | 3483 | **2026-04-13** | **MIT** | ✅ | 1/2/4/8/16/32 | 是 | 动漫（`cunet`/`anime`），`photo` 可写实 | 官方表：**197–3258 MB**（tile 100–400） | GTX-1070 实测：1000×1000→2000×2000 **2.35 s**（cunet, tile400）【实测·官方】 |
| **AnimeSR** | [TencentARC/AnimeSR](https://github.com/TencentARC/AnimeSR) | 372 | 2022-11-28 | **Apache-2.0**（含第三方组件例外清单） | ✅ | **仅 AnimeSR_v2_x4（只有 4x）** | 是 | **动漫动画专用**（Tencent ARC，NeurIPS 2022） | 未证实 | 未证实 |

> **⚠️ 480p 场景的关键否定结论 —— Anime4K 不适合本项目。** Anime4K 官方 README 原文：
> *"Anime4K is optimized for **native 1080p anime** encoded with h.264, h.265 or VC-1. Even if it might work, it is **not** optimized for downscaled 720p, **480p** or standard definition anime (eg. DVDs). ... This is also **not replacement for SRGANs**, as they perform much better on low-resolution images or images with lots of degradation (albeit not in real time)."*
> 来源：https://github.com/bloc97/Anime4K 。SVFI 官方文档对 Anime4K 的评价同样是「极快、实时向、保守，**细节上限低**」。→ **480p 修复请用 Real-CUGAN / Real-ESRGAN，不要把 Anime4K 当主力。**

> **⚠️ Real-CUGAN 与 Real-ESRGAN 的取舍（来自 SVFI 官方文档 2026-09-10 版）**：
> - realCUGAN：**动漫超分主力 ★★★★★**，「更锐利的线条，更好的纹理保留，虚化区域保留」
> - RealESRGAN：**「偏脑补、更锐、更艳」，但「容易过锐」**；RealESRNet 则「偏涂抹、保原色」
> - AnimeSR_v2_x4：「比 CUGAN 更保守」，且**只有 4x 一个倍率**
> 来源：https://doc.svfi.group/zh/pages/sr-models/

### 1.2 视频超分 / 修复（时序一致）

| 模型 | 仓库 / 论文 | ★ | 最近更新 | 许可 | 可商用 | 倍率 | 时序一致 | 倾向 | 显存 | 速度量级 |
|---|---|---|---|---|---|---|---|---|---|---|
| **BasicVSR++ / RealBasicVSR** | [ckkelvinchan/BasicVSR_PlusPlus](https://github.com/ckkelvinchan/BasicVSR_PlusPlus)、[RealBasicVSR](https://github.com/ckkelvinchan/RealBasicVSR)、[open-mmlab/mmagic](https://github.com/open-mmlab/mmagic) | 1112 (RBVSR) / 7472 (mmagic) | 2023-06-05 / 2024-08-06 | **Apache-2.0** | ✅ | x4（RBVSR） | ✅ 强（光流循环，`--max-seq-len` 控制递归窗口） | 写实向 | 递归窗口长则显存高 | 中等；SVFI 用作「抗压缩」一倍修复模型 |
| **VRT / RVRT** | [JingyunLiang/VRT](https://github.com/JingyunLiang/VRT) / mmagic 内 RVRT | 见仓库 | 见仓库 | Apache-2.0（随 mmagic） | ✅ | x4 | ✅ | 通用/写实 | 高（Transformer，需 tile） | 慢；不适合全量批处理 |
| **MambaIR** | [csguoh/MambaIR](https://github.com/csguoh/MambaIR) | 见仓库 | 见仓库 | 见仓库（未抓取原始 LICENSE →【未证实】） | 待核 | x2/x3/x4 | 图像为主 | 通用 | 中 | 未证实 |
| **SeedVR2（ByteDance）** | [ByteDance-Seed/SeedVR](https://github.com/ByteDance-Seed/SeedVR)、[arXiv:2506.05301](https://arxiv.org/abs/2506.05301) | 1383 | **2026-01-27**（ICLR 2026 接收） | **Apache-2.0（代码 + 权重均为 Apache-2.0）** | ✅ | 任意分辨率（无固定倍率，直接指定输出 H/W） | ✅ 强（因果 3D VAE + 时序 batch） | 通用，**AIGC 视频亦覆盖** | 见下 | 见下 |
| **Upscale-A-Video** | [Vchitect/Upscale-A-Video](https://github.com/Vchitect/Upscale-A-Video) | 见仓库 | 见仓库 | 未抓取到 LICENSE（README/LICENSE 均 404 →【未证实】） | 待核 | 任意 | ✅ | 写实 | 极高（扩散 + 分块） | **SeedVR 论文实测：31 帧 @1344×768，50 步 → 414 秒**（即 ≈13.4 s/帧）【实测·论文】 |
| **STAR** | CVPR2025（SeedVR2 论文 Table 1 baseline） | 未证实 | 未证实 | 未证实 | 待核 | — | ✅ | 写实 | 极高 | 同量级 50 步扩散；GSB 对比被 SeedVR2 大幅超越 |
| **SUPIR** | [Fanghua-Yu/SUPIR](https://github.com/Fanghua-Yu/SUPIR) | 5678 | 见仓库 | **专有「Non-Commercial Use Only」** | ❌ **禁止商用** | 任意 | 图像为主 | 写实 | 高 | 见 §3 |
| **StableSR** | [IceClear/StableSR](https://github.com/IceClear/StableSR) | 见仓库 | 见仓库 | 见仓库 →【未证实】商用条款需核 | 待核 | 任意 | 弱（图像） | 通用 | 高 | 未证实 |
| **DAT / HAT / SwinIR** | [zhengchen1999/DAT](https://github.com/zhengchen1999/DAT)、[XPixelGroup/HAT](https://github.com/XPixelGroup/HAT)、[JingyunLiang/SwinIR](https://github.com/JingyunLiang/SwinIR) | 546 / 1598 / 5603 | 2024-11-26 / 2024-06-02 / 2024-05-14 | **Apache-2.0** | ✅ | x2/x3/x4 | ❌ 单帧 | 通用（需按内容选模型） | 中–高 | **DAT-light 专为 720p 设计：573K 参数 / 49.69 GFLOPs @1280×720**（DAT-S 为 11.21M / 203.34 GFLOPs @512²）→ DAT-light 是唯一适合批量的 Transformer 档 |

#### SeedVR2 重点核实结果

**① 许可：Apache-2.0，代码和权重都是。**
- 代码仓库 LICENSE 原文：Apache License 2.0（https://raw.githubusercontent.com/ByteDance-Seed/SeedVR/main/LICENSE ）
- 官方 README 末尾明写：*"📜 License — SeedVR and SeedVR2 are licensed under the Apache 2.0."*
- HuggingFace 权重（经 hf-mirror.com API 核实）：
  - `ByteDance-Seed/SeedVR2-3B` → `license: apache-2.0`
  - `ByteDance-Seed/SeedVR2-7B` → `license: apache-2.0`
  - `ByteDance-Seed/SeedVR-7B` → `license: apache-2.0`
- **结论：无 CC-BY-NC 类限制，允许商用。** ✅

**② 官方给出的分辨率/时长与显存对比（README 原文）**
> *"**GPU Requirement:** We adopt sequence parallel to enable multi-GPU inference and **1 H100-80G can handle videos with 100x720x1280**. **4 H100-80G further support 1080p and 2K videos (sp_size=4)**. We will support more inference tricks like Tile-VAE and Progressive Aggregation Sampling in the future."*
> 来源：https://github.com/ByteDance-Seed/SeedVR

注意：这是**容量声明（能否装下）**，不是速度。1×H100-80G 处理 720p×100 帧是上限；**1080p 需要 4×H100-80G（序列并行 sp_size=4）**。

**③ 官方速度对比**
- SeedVR2 README/论文 Fig.1：*"our SeedVR2 is **over 4× faster** than existing diffusion-based video restoration approaches"*（对比对象为 UAV / MGLD-VSR / VEnhancer / STAR 等 50 步扩散）。
- SeedVR（v1, CVPR2025 Highlight）论文：*"VEnhancer takes **387 seconds** to generate **31 frames** at 1344×768 with 50 sampling steps... Upscale-A-Video... takes **414 seconds** to process the same video clip"*。来源：https://arxiv.org/html/2501.01320v3
- **【推算】** 取 (387+414)/2 ≈ 400 s ÷ 4 ≈ **100 s / 31 帧 @1344×768（≈3.2 s/帧）** → 折算到 1920×1080（像素数 ×2.0）≈ **6.5 s/帧** → 1 分钟 30fps 视频（1800 帧）≈ **3.25 H100·小时**。区间给 1.5–3.5 H100·小时。**置信度低**（跨两篇论文串联推导，未含 batch/量化/序列并行优化）。

**④ 长视频分块与工程参数（ComfyUI 官方集成，权威且实用）**
- 官方 ComfyUI 文档：https://docs.comfy.org/zh/tutorials/utility/seedvr2
- 社区节点/CLI：https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler （代码同样 Apache-2.0）
- **`batch_size` 必须是 4n+1**（1, 5, 9, 13, 17, 21, 25…），源自时序一致性架构；官方建议 batch_size 对齐镜头长度。
- **长视频流式分块 CLI（官方示例）**：
  ```bash
  python inference_cli.py long_video.mp4 \
      --resolution 1080 --batch_size 33 \
      --chunk_size 330 --temporal_overlap 3 \
      --video_backend ffmpeg --10bit
  ```
  即：**330 帧一块，块间重叠 3 帧做混合**，`--10bit` 走 x265 10bit 减少色带。
- **低显存（8GB）配置**：GGUF Q4 量化 + BlockSwap + VAE tiling：
  ```bash
  python inference_cli.py video.mp4 --dit_model seedvr2_ema_3b-Q8_0.gguf \
      --resolution 1080 --blocks_to_swap 32 --swap_io_components \
      --dit_offload_device cpu --vae_offload_device cpu
  ```
- 显存档位建议（官方 README）：8GB 以下 → GGUF Q4 + BlockSwap + VAE tiling；12–16GB → FP8；**24GB+ → FP16（质量与速度最好，无需内存优化）**。
- 可用注意力后端：FlashAttention 2/3、SageAttention 2/3、PyTorch SDPA 自动回退。

**⑤ 已知问题（务必提前规避）**
- **官方自曝的过锐化问题（对本项目极关键）**：README「Limitations」原文
  > *"due to the strong generation ability, Our methods tend to **overly generate details on inputs with very light degradations**, e.g., 720p AIGC videos, leading to **oversharpened results occasionally (especially on small resolutions, e.g., 480p)**."*
  → libtv 的 480p AIGC 动漫素材正好命中这个失败模式。缓解：用 `seedvr2_7b_sharp_fp16` 之外的**非 sharp 权重**、降低 batch（更保守）、或做输出与输入的 LAB 色彩/直方图匹配。
- **VAE 是绝对瓶颈（论文 §4.3 原文）**：
  > *"the causal video VAE requires **over 4x more time** to encode and decode a video compared to the naive VAE... when dealing with a **720p video with 100 frames, the causal video VAE takes over 95% of the total time**."*
  → 单纯优化 DiT 收益极小，**必须优化 VAE**（VAE tiling、batch 放大、torch.compile）。
- **社区实测**：GitHub Issue #432（RTX 5070 12GB，batch 21，240p→720p）：*"Encoding and upscaling is working as normal, but **decoding one batch takes 10 mins plus**."* 来源：https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler/issues/432
- **ComfyUI 官方已知 Bug**：INT8 量化模型 + FlashAttention 在 RTX 3090 上会**静默输出全黑**。解决：禁用 FlashAttention，或改用 FP16/FP8 权重。（https://docs.comfy.org/zh/tutorials/utility/seedvr2 ）

### 1.3 一体化工具链

| 工具 | 仓库 | ★ | 最近更新 | 许可 | 商用风险 | 说明 |
|---|---|---|---|---|---|---|
| **Video2X** | [k4yt3x/video2x](https://github.com/k4yt3x/video2x) | 21958 | **2026-03-07** | **AGPL-3.0** | ⚠️ **高** | 6.4.0 版，C/C++ 重写；集成 Anime4K v4 + Real-ESRGAN + Real-CUGAN + RIFE（经 ncnn/Vulkan）。官方 README 明载「This project is licensed under **GNU AGPL version 3**」。**作为网络服务对外提供会触发 AGPL 源码开放义务** → 建议只作内部工具或彻底自研替代 |
| **chaiNNer** | [chaiNNer-org/chaiNNer](https://github.com/chaiNNer-org/chaiNNer) | 6059 | 活跃 | **GPL-3.0** | ⚠️ 中 | 节点式图像处理 GUI，支持 PyTorch/NCNN/ONNX/TensorRT；进程级调用一般可隔离 GPL 义务，但需法务确认 |
| **SVFI（松鼠补帧）** | [Justin62628/Squirrel-RIFE](https://github.com/Justin62628/Squirrel-RIFE)、[Steam](https://store.steampowered.com/app/1692080/) | 见仓库 | 文档 **2026-09-10** | **闭源商业软件**（Steam 付费，"专业版 DLC"） | ⚠️ 需购商业授权 | **不是开源方案**；但它的官方文档是极佳的工程参考（见 §4） |
| **Flowframes** | [N00MKRAD/Flowframes](https://github.com/N00MKRAD/Flowframes) | 见仓库 | 见仓库 | 「open-source donationware」，最新构建走 Patreon 早鸟 | ⚠️ 待核 | Windows GUI，RIFE/DAIN/FLAVR。**支持「帧去重」（Frame De-Duplication），官方注明「This is meant for 2D animation」——动漫补帧的必备前处理** |
| **Real-ESRGAN-ncnn-vulkan** | [xinntao/Real-ESRGAN-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) | 见仓库 | — | MIT | ✅ | 免 CUDA/PyTorch，Intel/AMD/NVIDIA 通用；**注意官方警告：分块推理会产生「block inconsistency」，且与 PyTorch 实现结果略有差异** |
| **ComfyUI-SeedVR2 节点** | [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | 见仓库 | v2.5.24（2025-12-24） | **Apache-2.0** | ✅ | SeedVR2 在 ComfyUI 中的事实标准实现，含 CLI、流式分块、10bit 输出 |

---

## 2. 帧插值（补帧）模型清单

> 本节的**权威交叉验证源**：SVFI 官方文档「补帧模型说明」（更新 **2026-09-10**）https://doc.svfi.group/zh/pages/vfi-models/ —— 这是一个成熟中文商业产品对候选算法的真实评价，含推荐指数与显存/速度定性结论。

| 模型 | 仓库 | ★ | 最近更新 | 许可 | 可商用 | 显存 | 速度 | 动漫适配 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| **RIFE（Practical-RIFE）** | [hzwer/Practical-RIFE](https://github.com/hzwer/Practical-RIFE) | 1029 | 仓库 **2026-08-27** 活跃；**最新模型 4.26 = 2024-09-21** | **MIT** | ✅ | 低 | **快** | ⭐ **4.25 官方称「动漫场景显著改进」；4.24+ 明确适合扩散生成视频后处理** | 支持非整数倍率（4.6+） |
| **RIFE（主仓）** | [hzwer/ECCV2022-RIFE](https://github.com/hzwer/ECCV2022-RIFE) | 5599 | 2025-09-10 | **MIT** | ✅ | 低 | 快 | 见上 | 旧主仓，权重已迁至 Practical-RIFE |
| **rife-ncnn-vulkan** | [nihui/rife-ncnn-vulkan](https://github.com/nihui/rife-ncnn-vulkan) | 1104 | 2024-01-02 | **MIT** | ✅ | 低 | 中（Vulkan，N卡/A卡/核显通用） | 内置 `rife-anime`，但仅对应上游 **RIFE 1.8**（很旧） | **模型上限 `rife-v4.6`**；支持 `-s` 任意时刻、`-u` UHD |
| **GMFSS_Fortuna** | **[98mxr/GMFSS_Fortuna](https://github.com/98mxr/GMFSS_Fortuna)** | 未证实 | 2023-06-25 | **MIT** ✅ | ✅ **可商用** | **高** | **慢** | ⭐⭐ **动漫插帧专用**（"Dedicated for Anime Video Frame Interpolation"） | 见 §2.1.1 |
| **FILM** | [google-research/frame-interpolation](https://github.com/google-research/frame-interpolation) | 3154 | 2024-08-10 | **Apache-2.0** | ✅ | 中–高 | 慢 | 一般 | ⚠️ **仓库已 archived** |
| **AMT** | [MCG-NKU/AMT](https://github.com/MCG-NKU/AMT)（CVPR2023） | 未证实 | 未证实 | 未证实 | 待核 | 中 | 中 | 通用 | — |
| **EMA-VFI** | [MCG-NJU/EMA-VFI](https://github.com/MCG-NJU/EMA-VFI) | 503 | 2023-05-29 | **Apache-2.0** | ✅ | 中 | 中 | 通用 | — |
| **IFRNet** | [ltkong218/IFRNet](https://github.com/ltkong218/IFRNet) | 未证实 | 未证实 | 未证实 | 待核 | 低 | 快 | 通用 | — |
| **XVFI** | [JihyongOh/XVFI](https://github.com/JihyongOh/XVFI) | 未证实 | 未证实 | 未证实 | 待核 | 高 | 慢 | 通用 | 支持任意时刻 |
| **SAFA**（时空联合超分+插帧） | [megvii-research/WACV2024-SAFA](https://github.com/megvii-research/WACV2024-SAFA)（WACV2024，RIFE 作者团队） | 未证实 | 未证实 | 未证实 | 待核 | 未证实 | 未证实 | 通用 | **一体化 SR+VFI**，理论上比两段式省算力，建议评估 |
| **VFIMamba**（**2024 新方案**） | [MCG-NJU/VFIMamba](https://github.com/MCG-NJU/VFIMamba)（**NeurIPS 2024**，[arXiv:2407.02315](https://arxiv.org/abs/2407.02315)） | 未证实 | 2024-09-26（NeurIPS 接收） | **Apache-2.0** ✅ | ✅ | 未证实 | 未证实 | 通用 | ⭐ **首个把 SSM/Mamba 用于插帧**；官方称在多数据集达 SOTA，**「特别在高分辨率 VFI 任务上有潜力」**。有 **VFIMamba-S**（高效）与 VFIMamba（更强）；支持 2x 与 **Nx 任意倍率**；权重在 [HF](https://huggingface.co/MCG-NJU/VFIMamba_ckpts)。环境需 CUDA 11.7 / torch 1.13.1 / `mamba_ssm`（需编译） |
| **MoMo**（**2025 新方案**） | [JHLew/MoMo](https://github.com/JHLew/MoMo)（**AAAI 2025**，[arXiv:2406.17256](https://arxiv.org/abs/2406.17256)） | 未证实 | 2024-12-04（新增轻量版权重） | **Apache-2.0** ✅ | ✅ | 未证实 | 未证实 | 通用 | 「Disentangled Motion Modeling」；**提供 MoMo-10M 轻量版**；单行命令 `python demo.py --video in.mp4 --output_path out.mp4` |

> **三条关键的表格外说明**：
> 1. **ncnn 路径在模型版本上落后约 1.5 年**：`rife-ncnn-vulkan` 官方最高只到 `rife-v4.6`；而 CUDA/PyTorch 版已有 **4.22/4.25/4.26**。要最新模型必须走 CUDA 路径。（SVFI 文档称其社区版 ncnn 支持到 `4.22_lite`，那是 SVFI 自行转换的权重，**非 nihui 官方仓库内容**。）
> 2. **FILM 已归档（archived）**，不再维护，不建议作为新项目主力。
> 3. **GMFSS 家族谱系**（全部 MIT）：`GMFSS`（[YiWeiHuang-stack](https://github.com/YiWeiHuang-stack/GMFSS)，原始）→ `GMFupSS`（[更快](https://github.com/98mxr/GMFupSS)，README 注明「This item will not be updated!」）→ `GMFSS_union` → **`GMFSS_Fortuna`（当前推荐）**。

### 2.1 动漫补帧专项（本项目最关键的一节）

#### 2.1.1 GMFSS_Fortuna：动漫补帧最优自建方案（MIT，已核实）

来源：https://github.com/98mxr/GMFSS_Fortuna （README + LICENSE 原文均已获取）

- **许可：MIT**（`Copyright (c) 2023 98mxr`）→ **可商用**，无任何非商用限制。这对「自建动漫补帧」是决定性利好。
- **定位**：README 首行原文 —— *"The All-In-One GMFSS: **Dedicated for Anime Video Frame Interpolation**"*。
- **开发背景**：README 末尾「Acknowledgment」原文 —— *"This project is supported by **SVFI** Development Team"* → 它就是在 SVFI 的生产环境里打磨出来的动漫插帧模型。
- **两种模式**：
  ```bash
  # gmfss 模式
  python3 inference_video.py --img=demo/ --scale=1.0 --multi=2
  # union 模式（推荐，质量取向）
  python3 inference_video.py --img=demo/ --scale=1.0 --multi=2 --union
  ```
- **模型 Zoo**：GMFSS model、union model、**new union model（用 anime optical flow 数据 fine-tune —— 这正是动漫光流特化的版本，对本项目最有价值）**、以及用于跳过 baseline 训练的 pre-trained model。
- **环境**：PyTorch 1.13.1 / CUDA 11.8 / Python 3.9；需 **CuPy**（CUDA 12.x 需把 requirements 里的 `cupy-cuda11x` 换成 `cupy-cuda12x`，**不可同时安装**）。
- **家族谱系**（全部 MIT）：`GMFSS`（YiWeiHuang-stack，原始）→ `GMFupSS`（**更快**，2023-04-03 起停止更新）→ `GMFSS_union` → **`GMFSS_Fortuna`（当前推荐）**。
- **性能**：README **未给出任何 benchmark 或显存数字**；SVFI 文档仅定性描述「动漫补帧质量标杆」「慢」「显存占用高，不建议直接补 4K 及以上」。→ 速度/显存**【未证实】，必须本地实测**。
- SVFI 中对应的生产版本为 `GmfSs_pg_104 / pg_104_lite / pg_104_pro / pg_117 / pg_119 / union_v`，推荐指数 ★★★★☆，评价「最强之一的动漫补帧」「慢；专业版更建议 Tariff」。

> **给 libtv 的结论**：**GMFSS_Fortuna（union + anime-flow fine-tuned 模型）是自建路线里动漫补帧的画质上限方案，且许可干净（MIT）**。建议做成「RIFE 跑全量、GMFSS_Fortuna 跑关键镜头」的两级流水线。

#### 2.1.2 RIFE 版本选择（一手核实，官方 README）

来源：https://github.com/hzwer/Practical-RIFE （README 原文）

- **官方推荐：`4.25`** —— *"Currently, it is recommended to choose **4.25** by default for most scenes."*
- **`4.25`（2024.09.19）对动漫特别有价值** —— 官方说明：*"I am trying using more flow blocks, so the scale_list will change accordingly. **It seems that the anime scenes have been significantly improved.**"*
- **`4.24` 及以上适合 AI 生成视频后处理（直接命中 libtv 场景）** —— 官方说明：*"We find that **4.24+ is quite suitable for post-processing of some diffusion model generated videos**."*
- **`4.26`（2024.09.21）** 是最新版本；`4.25.lite`（2024.10.20）为低算力变体（"lite means using similar training framework, but lower computational cost model"）。
- 版本谱系：4.26 / 4.25(.lite) / 4.22(.lite) / 4.21 / 4.20 / 4.18 / 4.17(.lite) / 4.15(.lite) / 4.14(.lite) / v4.9.2 / v4.3 / v3.8 / v3.1
- **重要提示：仓库最近更新是 2026-08，但最新模型权重仍是 2024-09 的 4.26** —— 仓库维护活跃 ≠ 模型有更新。SVFI 文档也证实其最新官方模型是 `official_4.26 / 4.26_heavy / 4.22`。
- 4K 等高分辨率建议 `--scale=0.5`（或在推理时用 `--UHD`）。
- 作者另开发 **SAFA**（[megvii-research/WACV2024-SAFA](https://github.com/megvii-research/WACV2024-SAFA)，WACV 2024）—— **「Scale-Adaptive Feature Aggregation for Efficient Space-Time Video Super-Resolution」= 时空联合超分 + 插帧的一体化模型**，理论上比「先 SR 再 VFI」两段式更省算力，值得 libtv 评估。
- 官方把 **SVFI 列为推荐给普通用户的软件**，并致谢 *"SVFI team to support model testing on **Animation**"* —— 说明 RIFE 的动漫能力是在 SVFI 的实际动漫素材上验证过的。

#### 2.1.3 核心问题与实战要点（动漫补帧与实拍的根本差异）

**核心问题：2D 动漫不是「逐帧连续运动」，而是按拍数（on 1s / on 2s / on 3s）绘制，存在大量重复帧。** 直接插帧会把「重复帧」当成运动中间态，产生抖动/鬼影/线条融化。SVFI 的实测结论与方案：

1. **必须做「抽帧 / 帧去重」前处理**（这是动漫补帧与实拍补帧最大的工程差异）
   - Squirrel-RIFE（SVFI）官方 README 原文：*"包含抽帧处理，**可去除动漫卡顿感** / Deduplication removes animation clipping"*。https://github.com/Justin62628/Squirrel-RIFE
   - Flowframes 官方 README 原文：*"**Frame De-Duplication**: This is meant for **2D animation**. Removing duplicates makes a smooth interpolation possible. You should disable this completely if you only use content without duplicates (e.g. camera footage, CG renders)."* https://github.com/N00MKRAD/Flowframes

2. **最优的动漫方案可能不是「补满 60fps」，而是「保留原拍数」——DRBA**
   SVFI 文档对 DRBA 的描述：*「保留动漫原始节奏的补帧模型：**背景等线性运动被补上，角色等非线性运动仍按原拍数运动**。」* 这对漫剧观感非常关键：全画面补满 60fps 会让 2D 人物产生「廉价插帧感」。SVFI 的 `DRBA_Tariff_neu2_pge`（★★★★★，专业版）是当前其主推组合。

3. **动漫向候选排序（依据 SVFI 推荐指数）**
   - `Tariff`（新一代，质量对标 GMFSS pg104 但**快约一倍**）★★★★★ —— **闭源商业，仅 SVFI 专业版可用，不可自建**
   - `GMFSS pg_104` ★★★★☆ —— 自建可得的动漫补帧质量标杆，**慢**
   - `RIFE official_4.8`（动漫训练）★★★☆☆ —— 快，动漫观感尚可，实拍一般
   - `RIFE official_4.26 / 4.22` ★★★★☆ —— **最后的官方实拍模型**，覆盖绝大多数实拍场景
   - `UMSS` ★★★☆☆ —— 与 GMFSS 同属动漫向，部分镜头比 pg104 更顺、杂质更少
   - `AnimeJaNai`（超分侧，非插帧）—— 适用于 **3D 动漫**，但「景深识别弱，易锐化背景」

4. **场景切换（转场）必须单独处理**：Squirrel-RIFE 号称「高精度转场识别，可在多数视频中达到 **95% 以上**精确度，不破坏丝滑效果」。不做转场检测会在每个剪切点产生一帧「融合鬼影」。SVFI 的 GAS 里有完整的场景检测参数组（`scdet_flow_cnt`、`pure_scene_threshold`、`scene_list_ratio` 等）。

5. **⚠️ 显存红线（SVFI 官方原文）**：
   > *「注意 **GMFSS / UMSS / 部分 DRBA 显存占用高，不建议直接补 4K 及以上分辨率**。若要同时超分，请在输出分辨率里勾选 **先补帧后超分**，或拆成两步。**若瑕疵明显，使用 先超分再补帧**。」*
   → 1080p 输出场景下 GMFSS 尚可，但**必须实测显存**；4K/2K 输出时它会是第一个 OOM 的环节。

#### 2.1.4 2024–2025 新方案（尚未有动漫验证，值得 A/B）

| 方案 | 会议 | 许可 | 亮点 | 风险 |
|---|---|---|---|---|
| **VFIMamba** | NeurIPS 2024 | Apache-2.0 ✅ | 首个把 **SSM/Mamba** 用于插帧；官方称「**特别在高分辨率 VFI 任务上有潜力**」；VFIMamba-S 高效版；支持 2x 与 **Nx 任意倍率** | 需编译 `mamba_ssm`/`causal_conv1d`（CUDA 11.7 / torch 1.13.1），环境较挑；**README 完全没提动漫/动画**，动漫表现未知 |
| **MoMo** | AAAI 2025 | Apache-2.0 ✅ | Disentangled Motion Modeling；提供 **MoMo-10M 轻量版**；用法极简 `python demo.py --video in.mp4 --output_path out.mp4` | 显存/速度未证实；动漫未验证 |
| **SAFA** | WACV 2024 | 待核 | RIFE 作者团队；**时空联合超分+插帧一体化**，理论上省掉两段式的重复计算 | 未实测；一体化模型的显存通常更高 |

> **建议**：动漫场景下**仍以 RIFE 4.25 + GMFSS_Fortuna 为主**（这两者有明确的动漫验证记录）。VFIMamba/MoMo 属于「值得用小样本试，但别作为唯一依赖」的候选 —— 尤其 VFIMamba 的**高分辨率**宣称对 1080p 输出场景有吸引力。

---

## 3. 许可红线（法务必读）

| 等级 | 项目 | 许可条款 | 结论 |
|---|---|---|---|
| 🔴 **禁止商用** | **SUPIR** | README 有专门章节「**Non-Commercial Use Only Declaration**」：*"The SUPIR ('Software') is made available for use, reproduction, and distribution strictly for **non-commercial purposes**... you agree to abide by this restriction and **not to use the Software for any commercial purposes without obtaining prior written permission from Dr. Jinjin Gu**."* LICENSE 为 SupPixel Pty Ltd 专有协议，其中「Commercial Use」定义明确涵盖 *"Using the software to provide commercial consulting or contracting services, such as image analysis, enhancement, or modification for clients"* —— **正好命中 libtv 的 SaaS 场景**。 | ❌ **完全排除**（除非付费取得书面授权：jinjin.gu@suppixel.ai） |
| 🟠 **AGPL 传染** | **Video2X** | README: *"This project is licensed under **GNU AGPL version 3**"* | ⚠️ 若以网络服务形式对外提供 → 触发向用户提供完整对应源码的义务。**建议仅内部工具化使用，或自研替代** |
| 🟠 **GPL-3.0** | **chaiNNer** | GPL-3.0 | ⚠️ 进程级独立调用通常可隔离，但需法务确认；不建议链接进后端 |
| 🟡 **待核实** | **XVFI、IFRNet、AMT、MambaIR、StableSR、Upscale-A-Video、STAR** | 本轮**未成功抓取到原始 LICENSE 文件** | ⚠️ **上线前必须逐一到仓库根目录核对 LICENSE 原文** |
| 🟢 **可安全商用** | **Real-ESRGAN**（BSD-3-Clause）、**Real-CUGAN**（MIT，bilibili）、**Anime4K**（MIT）、**waifu2x-ncnn-vulkan**（MIT）、**RIFE / Practical-RIFE**（MIT）、**rife-ncnn-vulkan**（MIT）、**GMFSS_Fortuna / GMFupSS / GMFSS_union**（MIT，98mxr）、**VFIMamba**（Apache-2.0，NeurIPS2024）、**MoMo**（Apache-2.0，AAAI2025）、**SeedVR2 代码+权重**（Apache-2.0）、**BasicSR / mmagic / BasicVSR++ / RealBasicVSR**（Apache-2.0）、**AnimeSR**（Apache-2.0 + 第三方例外）、**HAT / DAT / SwinIR**（Apache-2.0）、**EMA-VFI**（Apache-2.0）、**FILM**（Apache-2.0，但已归档） | — | ✅ |

**⚠️ 一个容易忽略的陷阱**：Real-ESRGAN 主仓是 BSD-3-Clause，但其 Python 生态依赖 **BasicSR**。BasicSR 自身是 Apache-2.0，可商用，但 BasicSR 早期版本的某些组件许可曾有争议——**务必锁定版本并归档当时的 LICENSE 原文**作为合规证据。

**⚠️ SVFI 的定位澄清**：SVFI（Squirrel-RIFE / Steam 版）**不是开源方案**，它是基于 MIT 的 RIFE + MIT 的 waifu2x/Real-ESRGAN/Real-CUGAN 构建的**闭源商业软件**，超分功能需购买「专业版 DLC」。它的价值在于**官方文档是最好的工程参考**，而不是可以直接白嫖的代码。

---

## 4. 工程落地：流水线设计与坑

### 4.1 先插帧还是先超分？—— 有权威答案

**推荐：先超分，后插帧（SR → VFI）。** 依据：

1. **SVFI（成熟商业产品）就是这么做的**，官方文档原文：
   > *「既超分又补帧时，QL=0，TAT>1 为正常现象，尽量保证 SRL>0，SRTAT 以使显卡达到最大工作效率，**因为 SVFI 先超分后补帧**。」*
   来源：https://doc.svfi.group/zh/pages/other-advanced-settings/
2. **算力账**：先超分只需对 **1800 帧**做超分；先插帧则要对 **3600 帧**做超分 —— **直接贵一倍**。这对本项目（480p→1080p，2.25x）是决定性因素。
3. **质量账**：低分辨率下光流估计更准、更稳（高频伪影少），所以「在小分辨率上补帧」在运动估计上其实更友好；但代价是超分要在 2 倍帧数上跑。

**例外（SVFI 官方给的例外）**：当使用 **GMFSS / UMSS / DRBA 这类高显存插帧模型**时，可以让它们**先在小分辨率上补帧**，再对结果统一超分 —— 即勾选「先补帧后超分」或拆成两步，以规避 OOM。

> **给 libtv 的建议**：默认 **SR → VFI**；仅当显卡显存不足以在 1080p 跑 GMFSS 时，才改 VFI(480p) → SR。

### 4.2 分块（tile）与接缝

- **每个 tile 模型都会引入接缝**。Real-ESRGAN 官方 README 原文警告：*"Note that it may introduce **block inconsistency** (and also generate slightly different results from the PyTorch implementation), because this executable file first crops the input image into several tiles, and then processes them separately, finally stitches together."*
- Real-CUGAN 官方特别提供了「**无切割线版**」参数，并说明：*「由于 waifu2x-caffe 的切割机制，对于标准版，crop_size 应该尽量调大，否则可能造成切割线。」* 且**「无切割线版会造成更多的纹理涂抹和虚化区域清晰化」** → **接缝消除是有质量代价的**。
- 实践建议：
  1. **优先"整帧推理"**：854×480 输入在 24G 显存上完全装得下，`--tile 0`（不分块）是首选。
  2. 必须分块时，**tile 设大**（如 512/768）+ **加 padding/overlap**（一般 8–32 px）后裁剪拼接，而不是硬切。
  3. **在动漫上接缝更明显**（大色块 + 锐利线条），比写实素材更容易露馅。
- **时序分块（长视频）**：SeedVR2 官方做法是 `--chunk_size 330 --temporal_overlap 3`（块间重叠 3 帧做混合）；同类多帧模型（如 SVFI 的 Gloom）要求 **序列长度 = 4n+1**（1/5/9/…，建议 Gloom 用 16、Gloom-pro 用 33）——**这个 4n+1 约束在本轮调研中出现了两次（SeedVR2 与 Gloom），是多帧时序模型的一个通用规律，务必注意**。

### 4.3 时序闪烁（temporal flicker）

- 单帧图像超分（Real-ESRGAN / Real-CUGAN / HAT / DAT）**逐帧独立处理必然产生闪烁**——这是最大的观感风险。
- 缓解手段（按性价比排序）：
  1. **减小 batch 内的处理差异**：统一 tile 尺寸、禁用 TTA（TTA 会放大帧间噪声差异；Real-ESRGAN 官方明确「不建议开 TTA」用于 animevideov3）。
  2. **固定随机性**：任何含随机的模型（SeedVR2）务必**固定 seed**。
  3. **色彩/亮度后处理对齐**：SeedVR2 官方要求把 `color_fix.py` 放到 `projects/video_diffusion_sr/`，社区实现提供 **LAB color transfer** 与直方图匹配 — 这一步同时能压掉闪烁和色偏。
  4. **改用真正的时序模型**：BasicVSR++ / RealBasicVSR / SeedVR2（代价是速度）。
  5. SVFI 提供了 `is_evict_flicker`（去闪烁）等开关，说明这是一个需要显式处理的独立环节。

### 4.4 色深 / 色彩 / HDR

- **8bit 是默认陷阱**：SeedVR2 社区版的 `--10bit` 是**后来才加的**（v2.5.22, 2025-12-13），官方说明理由是 *"enable x265 encoding with 10-bit color depth, **reducing banding artifacts in gradients** compared to 8-bit OpenCV output"* → **动漫大面积渐变最容易出色带**，10bit 输出应作为默认。
- **全流程留在高精度**：SVFI 的管道模式支持 `rgb48be` / `yuv444p10le` 输入输出，官方示例：
  ```bash
  ffmpeg ... -vf copy,format=yuv444p10le,format=rgb48be,minterpolate=fps=24.000:mi_mode=dup \
    -f image2pipe -pix_fmt rgb48 -vcodec rawvideo - | \
    one_line_shot_args.exe -i - --pipe-in --pipe-iw 1920 --pipe-ih 1080 \
    --pipe-in-fps 24 --pipe-out --pipe-rgb --pipe-in-pixfmt rgb48be | \
    ffmpeg -y -vsync cfr -pix_fmt rgb48be -f rawvideo -r 24 -i - \
      -preset:v slow -c:v hevc_nvenc -pix_fmt yuv420p -crf 16 output.mp4
  ```
  **关键点：中间不要落盘成 8bit PNG/JPEG**，否则一次量化就丢掉了 10bit 的全部收益。
- **色带（banding）专项**：SVFI 有专门的 `DeepDeband` 修复模型（`deepdeband-f` / `deepdeband-w`）以及 `FMNet`（SDR→HDR10 转换，动漫向 `anime_v1/anime_v2/final`）。libtv 若目标是 HDR 交付，需额外引入这类模型。
- **色彩空间**：注意 `--pipe-colormatrix {470bg,170m,2020ncl,709}`，RGB↔YUV 转换矩阵必须显式指定，否则 BT.601/709 混用会导致色偏。

### 4.5 音频保留

- 拆帧→处理→合帧流程中，**音频必须从原片直接 copy，绝不能重编码**：
  ```bash
  ffmpeg -i out_frames/%08d.png -i input.mp4 -map 0:v:0 -map 1:a:0 -c:a copy \
         -c:v libx264 -r <fps> -pix_fmt yuv420p output.mp4
  ```
  （这是 Real-ESRGAN 官方 `anime_video_model.md` 给出的推荐写法）
- **补帧会改变帧率，但不改变时长**，因此音频无需变速。但**如果做慢动作**（例如 30fps 素材插到 120fps 再按 60fps 播放 = 0.5x），则**音频必须同步变速**（`atempo`）或干脆丢弃重配。
- SVFI 默认音频编码为 `aac @ 640k`（GAS 中 `encoded_audio_format` / `encoded_audio_bitrate`）。
- **注意 `-shortest`**：视频流与音频流长度不严格相等时用它兜底。

**官方参考工作流（rife-ncnn-vulkan README 原文，音频单独抽出再回灌）**：
```shell
ffmpeg -i input.mp4 -vn -acodec copy audio.m4a        # 抽音频（零损失）
ffmpeg -i input.mp4 input_frames/frame_%08d.png       # 拆帧
./rife-ncnn-vulkan -i input_frames -o output_frames   # 2 倍插帧
ffmpeg -framerate 48 -i output_frames/%08d.png -i audio.m4a \
       -c:a copy -crf 20 -c:v libx264 -pix_fmt yuv420p output.mp4
```
> 这个「先把音频抽成独立文件 → 处理完视频帧 → 再回灌」的模式比 `-map 1:a:0` 更健壮，尤其适合**长时间批处理**（合帧阶段才需要原片，中途可以只保留音频文件）。

### 4.6 编码参数

- **编码器选择**（按 libtv 场景排序）：
  1. **libx265 / hevc_nvenc**：1080p 交付主力。动漫用 10bit（`yuv420p10le`）减少色带。
  2. **libx264**：兼容性最好，但同画质码率更高；`-preset slow` 起。
  3. **AV1（libsvtav1 / av1_nvenc）**：码率最优，但**编码慢且需注意下游播放器兼容性**，漫剧分发场景风险较高。
- **CRF 参考**：动漫 1080p 用 x265 `-crf 18~22 -preset slow`；高保真中间产物用 `-crf 14~16`。SVFI 管道示例用的是 **`-crf 16 -preset:v slow`**（中间交付档）。
- **⚠️ 最大的隐性瓶颈是 CPU 编码，不是 GPU**。SVFI 官方专门做了「**解码压力 / 压制压力**」两个指标面板，并给出调优指南：
  > *「当解码压力与压制压力都为 0 时，说明当前没有遭遇性能瓶颈，是最佳状态。」*
  > *「未超分仅补帧时，QL 值长期维持在 10 以下说明**拆帧遇到瓶颈**…请检查 CPU 占用是否 100%，如是，**请更换 CPU 软编压制参数（如压制预设从 slow 改为 fast）**，或更换单核性能更强的 CPU。」*
  → **自建方案必须配一台多核 CPU 机器；只买 GPU 会让流水线卡在编解码上。** 用 `hevc_nvenc`/`h264_nvenc` 硬件编码可大幅缓解，代价是同码率画质略降。

### 4.7 可复现的参考命令链（骨架）

```bash
#!/usr/bin/env bash
# libtv: 480p@30fps -> 1080p@60fps  (SR-first, then VFI)
set -euo pipefail
IN="$1"; OUT="$2"
W=1920; H=1080; FPS_IN=30; FPS_OUT=60
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# ---------- Step 0: 探测元信息（保留音频/色彩元数据） ----------
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,pix_fmt \
        -of default=nw=1 "$IN"

# ---------- Step 1: 拆帧为 16bit PNG（避免中间 8bit 量化） ----------
mkdir -p "$WORK/in" "$WORK/sr"
ffmpeg -v error -i "$IN" -vsync 0 -pix_fmt rgb48be "$WORK/in/%08d.png"

# ---------- Step 2: 超分 480p -> 1080p ----------
# 方案 A（动漫主力，MIT，官方称 1080p 耗时 = CUNet 1x）：
#   Real-CUGAN 2x + 二次缩放到 1080p
# 方案 B（写实，BSD-3，快）：
#   realesr-animevideov3 XS 小模型，-s 2 后 outscale 到 1080p
# 单帧整图推理优先（854x480 装得下 24G），不要用 tile！
realesrgan-ncnn-vulkan -i "$WORK/in" -o "$WORK/sr" \
    -n realesr-animevideov3 -s 2 -t 0 -f png
# ↑ 若必须分块：-t 512（大 tile 减少接缝），切勿用小 tile

# ---------- Step 3: 补帧 30 -> 60fps（在 1080p 上做） ----------
mkdir -p "$WORK/out"
# 方案 1：rife-ncnn-vulkan（快、MIT、跨 N/A/核显）
#   官方用法：-i 输入目录 -o 输出目录，n 默认为 N*2（即 2 倍插帧）
#   官方 README 明确：`-n num-frame` 是「目标帧数」，不是倍率
rife-ncnn-vulkan -i "$WORK/sr" -o "$WORK/out" -m models/rife-v4.6
#   ⚠️ ncnn 版最高只到 rife-v4.6；要 4.25/4.26 必须走 CUDA/PyTorch 版：
# 方案 2：Practical-RIFE 4.25（官方推荐版，动感场景改进；4.24+ 适合扩散生成视频）
#   python3 inference_video.py --img="$WORK/sr/" --multi=2
# 方案 3：GMFSS_Fortuna（动漫画质上限，MIT，慢）
#   python3 inference_video.py --img="$WORK/sr/" --scale=1.0 --multi=2 --union
# ↑⚠️ 动漫素材务必先做「帧去重（抽帧）」再插帧，并做转场检测（见 §2.1.3）

# ---------- Step 4: 合帧 + 音频直通 + 10bit 编码 ----------
ffmpeg -y -framerate "$FPS_OUT" -i "$WORK/out/%08d.png" -i "$IN" \
    -map 0:v:0 -map 1:a:0 -c:a copy \
    -c:v libx265 -preset slow -crf 18 -pix_fmt yuv420p10le \
    -x265-params "colorprim=bt709:transfer=bt709:colormatrix=bt709" \
    -movflags +faststart -shortest "$OUT"
```

**逐条注意点**：
- `-vsync 0`（拆帧）/ `-vsync cfr`（合帧）：前者防止重复帧被丢弃或复制，后者保证恒定帧率输出。
- 音画同步靠 `-map 1:a:0 -c:a copy`（音频零损失直通），**不要**重新编码。
- **VFR（可变帧率）素材**：先 `ffmpeg -i in.mp4 -fps_mode cfr -r 30 ...` 或按 SVFI 的做法用 `minterpolate=fps=30:mi_mode=dup` 转成 CFR 再处理；否则帧序号与时间戳会错位。
- `-movflags +faststart` 让 moov atom 前置，Web 播放可边下边播。
- 中间帧落盘会占大量磁盘（1800 帧 16bit PNG ≈ 数十 GB），生产环境建议用 **pipe 模式**（如 SVFI 的 `--pipe-in/--pipe-out`）避免落盘。
- **`-framerate` 必须放在 `-i` 前面**（输入选项），否则 ffmpeg 会按默认 25fps 解释图像序列。

---

## 5. 硬件与成本估算（本文最重要的一节）

### 5.1 任务定义

| 项 | 值 |
|---|---|
| 输入 | 854×480 (480p)，30 fps，时长 60 s → **1800 帧** |
| 输出 | 1920×1080 (1080p)，60 fps，时长 60 s → **3600 帧** |
| 流水线 | **SR 先做**（1800 帧 480p→1080p），**VFI 后做**（1080p 上 1800→3600 帧） |

### 5.2 估算锚点（全部可溯源）

| 编号 | 锚点 | 来源 | 性质 |
|---|---|---|---|
| A | waifu2x-ncnn-vulkan **cunet**：GTX-1070，1000×1000→2000×2000 = **2.35 s**（tile 400）→ 约 **0.59 s / 输出 Mpx** | [waifu2x README](https://github.com/nihui/waifu2x-ncnn-vulkan) | **实测（官方）** |
| B | 1080p 单帧耗时：**waifu2x(CUNet) 1.0×**、**Real-CUGAN 1.0×**、**Real-ESRGAN(Anime6B) 2.2×** | [Real-CUGAN README](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) | **实测（官方）** |
| C | 1080p 帧 = 2.0736 Mpx | 算术 | 确定 |
| D | GTX-1070 = 6.5 TFLOPS → RTX 4090 = 82.6 TFLOPS（12.7× 理论）。小卷积网络受显存带宽与 IO 限制，**取 6–10× 实际加速，中值 8×** | 官方规格 + 工程经验 | **【推算】** |
| E | VEnhancer 387 s / Upscale-A-Video 414 s 处理 **31 帧 @1344×768（50 步）** | [SeedVR1 论文](https://arxiv.org/html/2501.01320v3) | **实测（论文）** |
| F | SeedVR2 比上述多步扩散 VR **快 4×+**；**1×H100-80G 上限 100×720×1280，1080p 需 4×H100-80G**；**VAE 占 720p×100 帧总耗时 >95%** | [SeedVR2 README](https://github.com/ByteDance-Seed/SeedVR) + [论文 §4.3](https://arxiv.org/html/2506.05301v2) | **官方声明** |
| G | RTX 5070 12G，batch 21，240p→720p：**VAE decode 单批 >10 分钟** | [ComfyUI-SeedVR2 Issue #432](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler/issues/432) | **社区实测**（配置未必最优，仅作量级佐证） |
| H | 云 GPU 价格 | 见 §5.4（全部一手抓取） | **实测（官网）** |

### 5.3 单卡吞吐与耗时估算（RTX 4090 24G）

> 所有 GPU·秒 均为 **【推算】**，置信度 **中**（SR 部分）/**低**（VFI 部分，未找到硬来源）。VFI 部分按 RIFE 类 1080p 20–50 fps、ncnn-RIFE 8–20 fps、【推算】。

**SR 阶段（1800 帧，输出 1080p）**

| 模型档位 | 相对 CUNet 成本 | s / 帧 @4090 | 1800 帧总 GPU·秒 |
|---|---|---|---|
| `realesr-animevideov3`（XS 小模型） | ~0.4×（小模型，README 称 "XS size"） | ~0.061 | **~110 s** |
| `Real-CUGAN 2x`（动漫主力） | 1.0× （锚点 B） | ~0.152 | **~274 s** |
| `Real-ESRGAN x4plus` / `Anime6B` | 2.2× （锚点 B） | ~0.334 | **~602 s** |
| `AnimeSR_v2_x4` | 未证实 | — | 未证实 |
| `DAT-light` @720p（49.69 GFLOPs） | Transformer，远重于 CUNet | ~0.4–1.0（估） | ~720–1800 s ❌ 不推荐批量 |
| **SeedVR2 3B** | 扩散 DiT + 3D VAE | 见下 | — |

**VFI 阶段（1080p 上插入 1800 帧）**

| 方案 | 假定 fps | 1800 帧总 GPU·秒 | 说明 |
|---|---|---|---|
| RIFE 4.25 CUDA（PyTorch） | 20–50 fps | **36–90 s** | 官方 README 无 fps 基准，此为工程估值 |
| rife-ncnn-vulkan（Vulkan） | 8–20 fps | **90–225 s** | 跨平台通用，同代画质略逊 CUDA |
| **GMFSS_Fortuna（动漫专用，MIT）** | 4–8 fps | **225–450 s** | 动漫画质上限；显存高；**必须实测** |
| SAFA（时空联合超分+插帧） | 未证实 | 未证实 | 理论上可省掉两段式的重复计算，**建议评估** |

**端到端合计（每 1 分钟 1080p60 成片）**

| 档位 | 组合 | GPU·秒 | 等效 GPU·分钟 | 墙钟（单卡串行） |
|---|---|---|---|---|
| 🟢 **轻量/性价比** | animevideov3 XS + RIFE 4.25(CUDA) | ~170 s | ~2.8 min | ~3 min |
| 🟢 **轻量/Vulkan 通用** | animevideov3 XS + ncnn-RIFE | ~260 s | ~4.3 min | ~4–5 min |
| 🔵 **动漫主力（推荐）** | **Real-CUGAN 2x + RIFE 4.25(CUDA)** | **~334 s** | **~5.6 min** | **~6 min** |
| 🟣 **动漫高画质** | Real-CUGAN 2x + GMFSS_Fortuna | ~624 s | ~10.4 min | ~10–11 min |
| 🟠 **写实向** | Real-ESRGAN x4plus + RIFE 4.25 | ~662 s | ~11 min | ~11 min |
| 🔴 **生成式修复** | **SeedVR2 3B** + RIFE | **~1.5–3.5 H100·小时 / 分钟** | 90–210 H100·分钟 | 90–210 min（**4×H100 并行可压到 ~25–55 min**） |

### 5.4 云 GPU 租赁价（一手抓取，2026-10-04）

**国内平台（元/小时）**

| 平台 | GPU | 显存 | ¥/时 | 计费 | 来源 |
|---|---|---|---|---|---|
| **AutoDL** | **RTX 4090** | 24G | **1.98**（会员 1.88） | 按秒·**按开关机计费** | [autodl.com](https://www.autodl.com/home) |
| AutoDL | RTX 3090 | 24G | **1.39**（会员 1.32） | 同上 | 同上 |
| AutoDL | RTX 5090 | 32G | 2.93（会员 2.78） | 同上 | 同上 |
| AutoDL | L20 / A40 | 48G | 3.87 / 3.14 | 同上 | 同上 |
| AutoDL | A800-80G | 80G | 5.88（会员 5.59） | 同上 | 同上 |
| AutoDL | RTX PRO 6000 | 96G | 7.35 | 同上 | 同上 |
| AutoDL | **H800-80G / H20-96G** | 80/96G | **10.50** | 同上 | 同上 |
| AutoDL | MTT S4000（国产） | 48G | **1.96** | 同上 | 同上 |
| AutoDL | Ascend 910B2（国产） | 64G | 3.87 | 同上 | 同上 |
| 共绩算力 | RTX 4090 | 24G | 1.98（**抢占 1.19**） | 按秒 | [gongjiyun.com](https://www.gongjiyun.com/pricing) |
| 优云智算 | RTX 4090 | 24G | 1.92 起（**包月折 ¥1.60**） | 秒级 | [compshare.cn](https://www.compshare.cn/price-list) |
| 矩池云 | RTX 4090 / 3090 | 24G | 2.20 / 1.85 | 按量·**启动不计费** | [matpool.com](https://matpool.com/api/machines) |
| 矩池云 | A100-PCIE | 40G | 2.80 | 同上 | 同上 |

> **⚠️ AutoDL 没有 L4 / A10 / H100 / A100-40G / H200 档位。**

**AutoDL 完整价目表（数据源：官网首页打包 JS 的 `originalPrice` 字段，文件 Last-Modified 2026-09-24；经 MTT S4000 会员价 ¥1.86 与官网 Bing 摘要交叉验证吻合）**

| GPU | 显存 | ¥/时 | GPU | 显存 | ¥/时 |
|---|---|---|---|---|---|
| RTX 3060 | 12G | 0.63 | RTX 4090D | 24G | 2.08 |
| RTX 2080Ti / 3080 | 11/10G | 0.93 | RTX 3090Ti | 24G | 2.70 |
| RTX A4000 | 16G | 0.97 | RTX 5090 | 32G | 2.93 |
| RTX 3080Ti | 12G | 1.03 | A40 | 48G | 3.14 |
| **RTX 3090** | 24G | **1.39** | **L20 / Ascend 910B2** | 48/64G | **3.87** |
| V100 | 32G | 1.98 | L40 | 48G | 4.82 |
| **MTT S4000（国产）** | 48G | **1.96** | A800-80G | 80G | 5.88 |
| **RTX 4090** | 24G | **1.98** | A100 SXM4 | 80G | 7.03 |
| — | — | — | RTX PRO 6000 | 96G | 7.35 |
| — | — | — | **H800 / H20** | 80/96G | **10.50** |

**计费陷阱汇总（重要，直接影响成本模型）**

| 平台 | 陷阱 |
|---|---|
| **AutoDL** | **按「开关机时间」计费，不是按 GPU 实际计算时长**；关机不收费但**不预留 GPU**（下次可能无卡）；付费扩容数据盘**关机也计费**；系统盘 30GB ¥0.10/日、文件存储 >20GB 按 ¥0.01/GB/日（=¥0.30/GB/月，视频场景不可忽略）；**无卡模式 ¥0.1/时**（0.5核/2GB/无GPU，同一主账号仅 1 个）→ 用来做数据准备/上传；包年包月租期内无论开关机都计时，**最经济学法 = 包月后转按量退款** |
| **RunPod** | **Volume Disk 停机 $0.20/GB/mo，运行中仅 $0.10/GB/mo（停机存储翻倍）**；Serverless 单价显著高于 Pods（4090：$1.10 vs $0.74）；社区云无 SLA 且可能被抢占 |
| **Vast.ai** | `dph_total` 已含磁盘存储（≈$0.133/GB/月）；**网络按流量计费：下行 $2.67/TB、上行 $4.00/TB**；同型号价差极大（4090 从 $0.12 到 $0.43+） |
| **Modal** | 不收空闲费，但 **GPU 单价外还要叠加 CPU $0.0000131/core/秒 + 内存 $0.00000222/GiB/秒**；出网 $0.04/GiB |
| **Lambda** | 按分钟计费、**无出网费**；标价不含税；**8卡配置每卡单价最低**（H100 $3.99 vs 单卡 $4.29） |
| **优云智算** | 按量单价是**整机（GPU+CPU+内存）**价而非纯卡时；云硬盘 100GB 免费、扩容 ¥0.01/GB/天；高校/企业额外 95 折 |
| **共绩算力** | 按秒收费；**共享存储卷成本需叠加**（¥0.2/GB/月 + 区域缓存 ¥0.15/GB/月 + 对象存储流量 ¥0.2/GB/月）；裸金属按时长包（8卡起） |
| **矩池云** | **主机启动过程不产生费用**，进入运行状态才开始计费（对「频繁启停」的流水线最友好）；免费 5GB 网盘 |

> 注：`gongji.cloud` 域名连不通（HTTP 000），共绩算力实际官网为 **gongjiyun.com**。

**国外平台（折合 ¥/小时）**

| 平台 | GPU | 显存 | 原币/时 | ≈¥/时 | 来源 |
|---|---|---|---|---|---|
| **Vast.ai** | RTX 4090 | 24G | $0.121 起（中位 $0.268） | **0.81 起** | [console.vast.ai](https://console.vast.ai/api/v0/bundles/) |
| Vast.ai | A100 SXM4 / H100 | 80G | $0.403 起 / $1.604 起 | 2.71 / 10.78 | 同上 |
| **RunPod** | RTX 4090 | 24G | $0.34 社区 / $0.74 安全 | **2.28 / 4.97** | [runpod.io/pricing](https://www.runpod.io/pricing) |
| RunPod | **L4** | 24G | $0.44 / $0.49 | **2.96 / 3.29** | 同上 |
| RunPod | L40S | 48G | $0.79 / $1.09 | 5.31 / 7.32 | 同上 |
| RunPod | A100 SXM / H100 SXM / H200 | 80/80/141G | 1.39 / 2.69 / 3.59 | 9.34 / 18.08 / 24.12 | 同上 |
| **Lambda** | **A10** | 24G | **$1.29** | **8.67** | [lambda.ai](https://lambda.ai/service/gpu-cloud) |
| Lambda | A100 SXM / H100 SXM | 80G | 2.79 / 3.99 | 18.75 / 26.81 | 同上 |
| Modal | L4 / A100 / H100 | 24/80/80G | $0.000222/秒 … | 5.37 / 16.79 / 26.54 | [modal.com/pricing](https://modal.com/pricing) |

> **结论：国内 AutoDL / 共绩 / 优云 比国外便宜 2–10 倍。** RTX 4090 档位最优选择：**共绩抢占 ¥1.19/时**（适合离线批处理，可被回收）或 **AutoDL ¥1.98/时**（最稳）。**不要用 A100/H800 做视频推理**（无 NVLink 需求，¥5.88–10.5/时性价比极差）。
> **⚠️ 未能证实**：潞晨云（2026-09-21 起转为私有企业服务，公开价格已下架）、CoreWeave（Cloudflare 403）、阿里云/腾讯云 GPU 具体每卡时价（需登录+签名 API）、智星云（DNS 不可解析）。

### 5.5 每 1 分钟成片的处理成本（元）

按 GPU 单价 × GPU·秒：

| 档位 | GPU·秒/分钟成片 | AutoDL 4090 ¥1.98/h | 共绩抢占 4090 ¥1.19/h | Vast.ai 4090 ¥0.81/h | AutoDL 3090 ¥1.39/h\* |
|---|---|---|---|---|---|
| 🟢 轻量（XS + RIFE） | 170 | **¥0.09** | **¥0.06** | ¥0.04 | ¥0.11 |
| 🔵 **动漫主力（CUGAN + RIFE）** | 334 | **¥0.18** | **¥0.11** | ¥0.08 | ¥0.21 |
| 🟣 动漫高画质（+GMFSS_Fortuna） | 624 | **¥0.34** | ¥0.21 | ¥0.14 | ¥0.40 |
| 🟠 写实向（x4plus + RIFE） | 662 | **¥0.36** | ¥0.22 | ¥0.15 | ¥0.43 |
| 🔴 **生成式（SeedVR2 3B）** | 1.5–3.5 H100·h | **¥16–37**（H800 ¥10.5/h） | — | — | — |

\* 3090 列按 **GPU·秒 ÷ 0.6**（速度折算）再乘 ¥1.39/h 得出。折算依据：3090 FP32 算力为 4090 的 43%，但显存带宽为 93%（936 vs 1008 GB/s），小卷积模型偏带宽敏感，故取 0.6×。**结论：3090 的每元产出比 4090 低约 17%（1.98 vs 2.32 元/单位算力），4090 性价比更好**；3090 仅在 4090 抢不到卡时才作备选。

**对照买 API**：腾讯云 MPS ¥3.36/分钟；Topaz 官方约 ¥9–11/分钟。

> **自建便宜 10–35 倍**（纯 GPU 成本口径）。

### 5.5.1 进一步压价的三个手段

| 手段 | 单价 | 适用 | 风险 |
|---|---|---|---|
| **抢占式 / Job 批处理** | 共绩 4090 **¥1.19/时**（6折）、优云智算 4090 ¥1.31/时、共绩 H800 ¥15.00/时 | 离线批处理（漫剧成片不是实时业务，**非常适合抢占**） | 实例可能被回收，**必须做断点续跑/分片** |
| **包月折算** | 优云智算 4090 **¥1.60/时**（¥1154.64/月）；3090 ¥1.00/时；共绩裸金属 8卡30天包 **¥1.44/时/卡** | 月处理量稳定且量大 | 租期内无论开关机都计时，**闲置成本高** |
| **Vast.ai 社区价** | 4090 **$0.121 起**（≈¥0.81/时，中位 $0.268≈¥1.80） | 非关键批处理、可容忍失败重试 | 可用性/机房位置不确定，无 SLA |

**建议组合**：日常用 **AutoDL 4090 ¥1.98/时**（最稳、按秒、生态好）+ 大批量离线任务用 **共绩抢占 ¥1.19/时**（配合分片与断点续跑），可把动漫主力档成本进一步压到 **¥0.07–0.11/分钟成片**。

### 5.6 一句话结论：自建 vs 买 API 的划算界线

- **纯 GPU 成本口径**：自建动漫主力档 **¥0.11–0.18/分钟**，对比 MPS **¥3.36/分钟**，**每处理 1 分钟省约 ¥3.2**。
- **回本点（买机器）**：若采购 4090 整机约 ¥15,000（本次未抓取报价 →【未证实】），按每月 1,000 分钟成片、每月省 ¥3,200 计，**约 5 个月回本**；若月处理量 <300–500 分钟，买机器会闲置，**建议直接用云 GPU 按量**（无沉没成本），配合 ¥0.1/时的无卡模式做本地调试。
- **云 GPU 口径**：由于 ¥1.98/h 的 4090 一小时能产出约 10 分钟 1080p60 成片，**只要月处理量 ≥ 数十小时成片，云自建就已经显著优于买 API**。真正的门槛不是钱，而是**工程投入**（把拆帧/推理/补帧/合帧/转场检测/帧去重串成稳定流水线）。
- **⚠️ 前提与边界**：libtv 当前**没有任何 GPU 资源**，自建必须新增资本开支或云支出；同时**必须配够 CPU 做编码**，否则瓶颈从 GPU 转移到编解码（见 §4.6）。高清二次压缩（x265/AV1）的 CPU 成本**未计入**上表，实际总成本需上浮，**建议实测**。

### 5.7 置信度声明

| 结论 | 置信度 | 依据 |
|---|---|---|
| 许可协议（SUPIR 禁商用、Video2X AGPL、Real-ESRGAN/CUGAN/RIFE/**GMFSS_Fortuna** 可商用、SeedVR2 Apache-2.0 含权重） | **高** | 逐份 LICENSE 原文 / README 声明 / hf-mirror 模型卡 |
| 云 GPU 价格 | **高** | 官网/API 一手抓取，AutoDL 数据经交叉验证（MTT S4000 会员价 ¥1.86 与官网 Bing 摘要吻合） |
| SR 阶段 GPU·秒（基于 GTX-1070 官方实测锚点 + 8× 加速推算） | **中** | 锚点实测，但 1070→4090 加速比是估算，未含 TensorRT/INT8 优化 |
| VFI 阶段 GPU·秒 | **低** | **未找到 RIFE/GMFSS 在 1080p 上的官方 fps 硬数据**，为工程经验估值。**必须本地实测** |
| SeedVR2 吞吐（1.5–3.5 H100·h/分钟） | **低** | 跨 SeedVR1 论文与 SeedVR2 声明串联推导，未含序列并行/量化/VAE tiling 优化 |
| 相对比价结论（自建比 API 便宜 10–35×） | **中–高** | 价格侧高置信；速度侧中/低置信。即便 SR 速度估偏 2 倍，结论方向不变 |

---

## 6. 未证实清单（需后续核实）

### 6.1 许可未核实（**上线前必须逐一到仓库根目录核对 LICENSE 原文**）
1. ~~**GMFSS / GMFSS_Fortuna**~~ → ✅ **已核实为 MIT**（`98mxr/GMFSS_Fortuna`，LICENSE 原文已获取）
2. **AMT**（MCG-NKU/AMT）、**IFRNet**（ltkong218/IFRNet）、**XVFI**（JihyongOh/XVFI）
3. **MambaIR**（csguoh/MambaIR）、**StableSR**（IceClear/StableSR）
4. **Upscale-A-Video**（Vchitect/Upscale-A-Video）—— README 与 LICENSE 均 404
5. **STAR**（CVPR2025）—— 未定位到官方仓库
6. **Flowframes** —— 自称 "open-source donationware"，最新构建走 Patreon 早鸟，**商用条款需核实**

### 6.2 技术指标未证实
7. **RIFE（含 Practical-RIFE 4.x 系列）在 1080p 上的官方 fps 基准** —— ✅ **版本谱系已核实**（最新 4.26 = 2024-09-21，官方推荐 4.25），但**具体 fps/吞吐数字仍未证实**（README 未提供 benchmark 表）
8. **rife-ncnn-vulkan 的实测速度与模型上限** —— ✅ **已核实**：官方 README「Model」表最新只到 **`rife-v4.6`**（另有 `rife-anime` 但仅对应上游 1.8），**落后于 CUDA 版的 4.22/4.25/4.26**。SVFI 文档声称其社区版 ncnn 支持到 `4.22 / 4.22_lite`，**那是 SVFI 自行转换的权重，非 nihui 官方仓库内容**。官方仍未提供 benchmark 表 → 速度**【未证实】**
9. **GMFSS 的显存占用具体 GB 数** —— SVFI 仅定性说「显存占用高，不建议直接补 4K 及以上」
10. **GMFSS_Fortuna 的 star 数与实测速度** —— GitHub HTML 已无法抓取 star（API 限流 + HTML 结构变更），仓库 README 未给 benchmark
11. **AnimeSR_v2_x4 的显存与速度** —— README 未给
12. **MambaIR / VRT / RVRT / STAR 的显存与吞吐** —— 未获得
13. **Real-ESRGAN `realesr-animevideov3` 的官方吞吐** —— 官方只给相对值，无绝对 fps
14. **2025–2026 年基于 DiT / flow matching 的实时视频超分新方案** —— 本轮未系统覆盖（受检索工具限制），仅确认 SeedVR2（一步扩散 DiT）为当前代表
15. **基于 flow matching 的插帧新方案** —— **未证实**（本轮未找到确认使用 flow matching 的插帧仓库）。但**已找到 2024–2025 的两个新 SOTA 方向**，见下表上方表格：
   - **VFIMamba**（NeurIPS 2024，Apache-2.0）：首个将 **SSM/Mamba** 用于插帧，官方称对**高分辨率** VFI 有潜力
   - **MoMo**（AAAI 2025，Apache-2.0）：Disentangled Motion Modeling，有 **10M 轻量版**
   - 另有 **SAFA**（WACV 2024，RIFE 作者团队）：**时空联合超分+插帧一体化**，可能省掉两段式的重复计算
   → 这三者**均未实测，显存/速度/动漫表现全部未证实**，建议 libtv 用自家素材做 A/B。
16. **VFIMamba / MoMo 的显存与吞吐** —— 两者 README 均未提供 benchmark 表 → 未证实
17. **VFIMamba 的动漫表现** —— README 未提及动漫/动画场景 → 未证实（RIFE 与 GMFSS 在动漫上有明确记录，VFIMamba 没有）

### 6.3 成本相关未证实
18. **4090 整机采购报价**（约 ¥1.5–2 万为行业常见量级，**本次未抓取到报价**）
19. **阿里云 / 腾讯云 GPU 具体每卡时价**（需登录 + 签名 API；官方仅公布计费模式与「按量支持关机不收费」）
20. **潞晨云 / CoreWeave / 智星云 GPU 租赁价**（分别因转私有服务、Cloudflare 403、DNS 不可解析而未取得）
21. **RunPod 竞价折扣**（API 未区分竞价/按需价）
22. **x265/AV1 编码的 CPU 成本**（未量化，但 SVFI 文档证明它常是真实瓶颈）

### 6.4 检索工具限制说明
本轮内置 `web_search` 不可用；`cn.bing.com` 可用但**对相近查询会去重返回同一组结果**，`html.duckduckgo.com` / `searx.be` 均连接失败（HTTP 000）。GitHub REST API 未认证额度 **60 次/小时**，在调研中被耗尽（剩余 0），导致部分仓库的 star / 最近更新时间 / license 元数据未能取回 —— 相关字段已标注「未证实」，建议用 `curl https://api.github.com/repos/<owner>/<repo>` 补齐。

---

## 7. 给 libtv 的落地建议（按优先级）

1. **首选架构：Real-CUGAN 2x（动漫主力，MIT）+ RIFE 4.25（MIT，官方推荐版，且官方称动漫场景显著改进）+ SR-first 顺序**。480p 整帧推理（`tile=0`），10bit 全链路，音频直通。成本约 **¥0.11–0.18/分钟成片**。
   > 注：官方 README 明确 **4.24+ 适合扩散生成视频的后处理** —— 正好覆盖 libtv 的 AI 生成素材，这是选 RIFE 而非其他光流方案的额外理由。
2. **写实短剧分支**：切换为 Real-ESRGAN x4plus / RealBasicVSR；注意 Real-ESRGAN「容易过锐」，建议走 RealESRNet 或降低锐度。
3. **动漫补帧若要更高画质：GMFSS_Fortuna（MIT，可商用）**。它是明确的「动漫视频插帧专用」模型，且被 SVFI 团队支持开发。代价是慢（估算 4–8 fps @1080p）与显存高。建议 **RIFE 做全量、GMFSS 对关键镜头做精修** 的两级策略。
4. **动漫必须补的两件事**：① **帧去重（抽帧）前处理**；② **转场（场景切换）检测**，否则每个剪切点会出现融合鬼影。
5. **考虑 DRBA 式「保留原拍数」策略**：漫剧全画面补满 60fps 反而会有廉价插帧感。若无法拿到闭源的 Tariff/DRBA，可自研简化版（用光流一致性判断线性/非线性运动区域，只对背景补帧）。
6. **SeedVR2 只用于关键镜头/封面**：质量最好且 Apache-2.0 可商用，但**成本高一个数量级**（¥16–37/分钟）且官方自曝 480p AIGC 输入容易**过锐化**——正好命中 libtv 场景。若要用，务必先做小样本 A/B。
7. **合规动作**：立即可排除 SUPIR（禁商用）；Video2X（AGPL）只做内部工具；GMFSS 已确认 MIT（无需担忧）。剩余待核：AMT / IFRNet / XVFI / MambaIR / StableSR / Upscale-A-Video / STAR。
8. **不要忘记 CPU**：自建方案需配套多核 CPU 做 x265 编码，否则瓶颈从 GPU 转到编解码。
9. **值得评估的一体化/新方案替代**：RIFE 作者团队的 **SAFA**（时空联合超分+插帧，理论上比两段式更省算力）；以及 **VFIMamba**（NeurIPS2024）。建议用 libtv 自家素材做小样本 A/B。

---

*文档版本：v1（2026-10-04 初稿）。标注【推算】的数值建议在 libtv 实际素材上用 30 秒片段做端到端实测后替换。*