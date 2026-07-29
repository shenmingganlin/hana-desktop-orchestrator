import fs from "fs";

export const name = "vision-query";
export const description =
  "将截图发给视觉模型进行精确分析，返回元素在截图中的像素坐标。\n" +
  "视觉模型的 API 地址 / Key / 模型名在插件配置中设置。\n" +
  "适用于 UIA 无法定位的 GPU 渲染元素（QQ、Chrome 等）。\n" +
  "返回格式：{ x, y, width, height, label } 或错误信息。";
export const parameters = {
  type: "object",
  properties: {
    imagePath: {
      type: "string",
      description: "截图的本地文件路径（必须已存在，建议使用 PrintWindow 截取）",
    },
    imageWidth: {
      type: "integer",
      description: "截图的像素宽度。不传则从文件读取。",
    },
    imageHeight: {
      type: "integer",
      description: "截图的像素高度。不传则从文件读取。",
    },
    target: {
      type: "string",
      description: "要定位的目标描述，如「蓝色发送按钮」「×关闭按钮」「搜索框」",
    },
    returnFormat: {
      type: "string",
      enum: ["center", "bbox", "both"],
      default: "center",
      description:
        "返回格式：center([x,y]) 中心坐标 / bbox([x1,y1,x2,y2]) 边界框 / both 两者",
    },
  },
  required: ["imagePath", "target"],
};

export async function execute(input = {}, ctx = {}) {
  const imagePath = String(input.imagePath || "").trim();
  const target = String(input.target || "").trim();
  const returnFormat = input.returnFormat || "center";
  const inputWidth = input.imageWidth;
  const inputHeight = input.imageHeight;

  if (!imagePath || !fs.existsSync(imagePath)) {
    return JSON.stringify({ ok: false, error: "截图文件不存在: " + imagePath });
  }
  if (!target) {
    return JSON.stringify({ ok: false, error: "请指定要定位的目标描述" });
  }

  // 从 ctx 或直接读取插件配置文件
  const config = ctx.config || {};
  let apiBase = String(config.visionApiBase || "").trim();
  let apiKey = String(config.visionApiKey || "").trim();
  let model = String(config.visionModel || "").trim();

  // 如果 ctx.config 没读到，直接从文件读取（plugin-data 目录）
  if (!apiBase || !apiKey || !model) {
    try {
      const fs = (await import("fs")).default;
      const path = (await import("path")).default;
      const configPath = path.join(ctx.dataDir || process.cwd(), "config.json");
      if (fs.existsSync(configPath)) {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const g = fileConfig.global || {};
        if (!apiBase) apiBase = String(g.visionApiBase || "").trim();
        if (!apiKey) apiKey = String(g.visionApiKey || "").trim();
        if (!model) model = String(g.visionModel || "").trim();
      }
    } catch (e) { /* 静默降级 */ }
  }

  if (!apiBase || !apiKey || !model) {
    return JSON.stringify({
      ok: false,
      error:
        "视觉模型未配置。请在插件设置中填写 visionApiBase、visionApiKey、visionModel",
      config: {
        visionApiBase: apiBase ? "已设置" : "未设置",
        visionApiKey: apiKey ? "已设置" : "未设置",
        visionModel: model ? "已设置" : "未设置",
      },
    });
  }

  // 获取图片尺寸
  let imgWidth = inputWidth;
  let imgHeight = inputHeight;
  if (!imgWidth || !imgHeight) {
    try {
      const fd = fs.openSync(imagePath, "r");
      const buf = Buffer.alloc(24);
      fs.readSync(fd, buf, 0, 24, 0);
      fs.closeSync(fd);

      if (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47
      ) {
        imgWidth = buf.readUInt32BE(16);
        imgHeight = buf.readUInt32BE(20);
      } else if (buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset < buf.length - 1) {
          if (buf[offset] === 0xff && buf[offset + 1] === 0xc0) {
            imgHeight = buf.readUInt16BE(offset + 5);
            imgWidth = buf.readUInt16BE(offset + 7);
            break;
          }
          offset++;
        }
      }
    } catch (e) {
      /* 忽略 */
    }

    if (!imgWidth || !imgHeight) {
      return JSON.stringify({
        ok: false,
        error: "无法读取图片尺寸，请传入 imageWidth 和 imageHeight 参数",
      });
    }
  }

  // 读取图片并编码为 base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const formatInstructions = {
    center:
      "返回该元素中心点的像素坐标 [x, y]。只返回坐标，不要其他文字。",
    bbox:
      "返回该元素边界框的像素坐标 [x1, y1, x2, y2]（左上角和右下角）。只返回坐标，不要其他文字。",
    both:
      "返回该元素的完整信息：中心坐标 [cx,cy]，边界框 [x1,y1,x2,y2]，以及元素类型（如 button、input、icon）。格式：{ center: [cx,cy], bbox: [x1,y1,x2,y2], type: '...' }",
  };

  const prompt = `这张图片的尺寸是 ${imgWidth}×${imgHeight} 像素。
请在这张截图中找到「${target}」，并${
    formatInstructions[returnFormat] || formatInstructions.center
  }
坐标值必须是精确的像素值，范围在图片尺寸内。
如果找不到该元素，返回 null。`;

  // 调用视觉模型 API（支持 OpenAI 和 Anthropic 两种格式）
  const baseUrl = apiBase.replace(/\/+$/, "");
  const isAnthropicFormat =
    baseUrl.includes("anthropic") || baseUrl.includes("minimaxi");

  let response;
  try {
    const headers = {
      "Content-Type": "application/json",
    };

    if (isAnthropicFormat) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";

      const body = {
        model: model,
        max_tokens: 200,
        temperature: 0.01,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64Image,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      };

      response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;

      const body = {
        model: model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.01,
      };

      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: "API 请求失败: " + e.message });
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    return JSON.stringify({
      ok: false,
      error: `API 返回错误 ${response.status}`,
      detail: errText.slice(0, 500),
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: "解析 API 响应失败: " + e.message,
    });
  }

  // 解析响应（支持 OpenAI 和 Anthropic 格式）
  const isAnthropicResp = data.type === "message" || data.content?.[0]?.text;
  let resultText;

  if (isAnthropicResp) {
    resultText = (data.content?.[0]?.text || "").trim();
  } else {
    resultText = (data.choices?.[0]?.message?.content || "").trim();
  }

  let parsed = null;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    const centerMatch = resultText.match(/\[?\s*(\d+)\s*,\s*(\d+)\s*\]?/);
    if (centerMatch) {
      parsed = { x: parseInt(centerMatch[1]), y: parseInt(centerMatch[2]) };
    }
  }

  if (!parsed) {
    return JSON.stringify({
      ok: false,
      error: "视觉模型未能返回有效坐标",
      modelResponse: resultText.slice(0, 300),
    });
  }

  return JSON.stringify(
    {
      ok: true,
      target,
      imageSize: { width: imgWidth, height: imgHeight },
      result: parsed,
      modelResponse: resultText.slice(0, 200),
    },
    null,
    2
  );
}
