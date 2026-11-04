// NovaBot embeddings: multilingual-e5-small (quantized ONNX, 384 dims), local, no external API.
import http from "node:http";
import { pipeline, env } from "@huggingface/transformers";
env.cacheDir = process.env.MODEL_CACHE || "/models";
const MODEL = process.env.EMBED_MODEL || "Xenova/multilingual-e5-small";
const extractor = await pipeline("feature-extraction", MODEL, {
  dtype: "q8",
  session_options: {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    enableCpuMemArena: false,
    enableMemPattern: false,
  },
});
const MAX = 64;
http
  .createServer(async (req, res) => {
    if (req.url === "/health") return res.end('{"status":"ok","dims":384}');
    if (req.method !== "POST" || req.url !== "/embed") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    for await (const c of req) {
      body += c;
      if (body.length > 200_000) return res.destroy();
    }
    try {
      const { texts, kind } = JSON.parse(body);
      if (!Array.isArray(texts) || texts.length > MAX)
        throw new Error("texts: array of <= 64");
      const prefix = kind === "query" ? "query: " : "passage: ";
      const out = await extractor(
        texts.map((t) => prefix + String(t).slice(0, 2000)),
        { pooling: "mean", normalize: true },
      );
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ dims: out.dims[1], vectors: out.tolist() }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  })
  .listen(Number(process.env.PORT || 4400), () =>
    console.log(`embed ready ${MODEL}`),
  );
